import json
import logging
import re
from collections import Counter
from typing import Dict, Any, Optional

from fastapi import HTTPException

from app.services.ai.base_generator import BaseAIGenerator


logger = logging.getLogger(__name__)


class BugGenerator(BaseAIGenerator):
    def _clean_schema_for_ai(self, schema: list) -> list:
        """
        Aggressively filters and minifies the Jira schema to prevent AI prompt bloat.
        Prioritizes required fields and common smart-inference fields.
        """
        SMART_FIELDS = {
            "priority", "severity", "component", "components", "version", "versions", 
            "fixversion", "fixversions", "environment", "labels", "epic"
        }
        
        # 1. Filter: Keep Required OR Smart Fields
        filtered = []
        for field in schema:
            name_lower = str(field.get("name", "")).lower()
            is_smart = any(keyword in name_lower for keyword in SMART_FIELDS)
            if field.get("required") or is_smart:
                filtered.append(field)
                
        # 2. Minify and Sort
        cleaned = []
        # Sort so required fields are processed first (and kept if we hit the cap)
        filtered.sort(key=lambda x: x.get("required", False), reverse=True)
        
        for field in filtered[:40]: # Hard cap at 40 fields
            f = {
                "key": field.get("key"),
                "name": field.get("name"),
                "type": field.get("type"),
                "required": field.get("required")
            }
            
            if "allowed_values" in field:
                av = field["allowed_values"]
                if isinstance(av, list):
                    f["allowed_values"] = av[:10]
                    if len(av) > 10:
                        f["allowed_values"].append({"id": "...", "name": "..."})
            
            cleaned.append(f)
            
        return cleaned

    def _extract_acceptance_targets(self, context_text: str) -> list[str]:
        if not context_text:
            return []

        lines = [line.strip(" -\t") for line in context_text.splitlines()]
        targets: list[str] = []
        capture = False

        for raw_line in lines:
            line = raw_line.strip()
            if not line:
                continue

            lower = line.lower()
            if "acceptance criteria" in lower:
                capture = True
                continue

            if capture:
                if re.match(r"^(description|summary|supporting context|user's bug observation)\b", lower):
                    break
                if len(line) > 6:
                    targets.append(line)
                    if len(targets) >= 8:
                        break

        if targets:
            return targets

        fallback = [line for line in lines if len(line) > 24]
        return fallback[:5]

    def _synthesize_analysis_summary(
        self,
        bugs: list[Dict[str, Any]],
        issue_type_mode: str,
        context_text: str,
    ) -> Dict[str, Any]:
        category_counter = Counter(
            str(bug.get("category") or "Functional Gap").strip()
            for bug in bugs
            if isinstance(bug, dict)
        )
        grouped_risks = [
            {
                "group": category.lower().replace(" ", "_"),
                "title": category,
                "description": f"{count} finding{'s' if count != 1 else ''} clustered around {category.lower()}.",
                "count": count,
            }
            for category, count in category_counter.most_common(4)
        ]

        top_category = grouped_risks[0]["title"] if grouped_risks else "Functional Gap"
        highest_risk_bug = max(
            bugs,
            key=lambda bug: {"critical": 4, "high": 3, "medium": 2, "low": 1}.get(str(bug.get("severity", "medium")).lower(), 0),
            default={},
        )
        highest_risk_area = (
            str(highest_risk_bug.get("summary")).strip()
            or f"{top_category} risk area"
        )

        targets = self._extract_acceptance_targets(context_text)
        refs_and_evidence = "\n".join(
            [
                *[str(ref) for bug in bugs for ref in (bug.get("acceptance_criteria_refs") or [])],
                *[str(ev) for bug in bugs for ev in (bug.get("evidence") or [])],
            ]
        ).lower()

        ac_coverage_map = []
        missing_ac_recommendations = []
        for index, target in enumerate(targets, start=1):
            target_lower = target.lower()
            significant_words = [word for word in re.findall(r"[a-z0-9]{4,}", target_lower) if word not in {"shall", "should", "with", "that", "when", "then"}]
            matched = any(word in refs_and_evidence for word in significant_words[:4]) if significant_words else False
            has_ac_ref = f"ac{index}" in refs_and_evidence or f"ac {index}" in refs_and_evidence
            status = "covered" if has_ac_ref or matched else "missing"
            rationale = (
                "Referenced by one or more generated findings."
                if status == "covered"
                else "No generated finding clearly covered this expectation."
            )
            related_bug_indexes = [
                bug_index + 1
                for bug_index, bug in enumerate(bugs)
                if any(
                    str(ref).lower() in {f"ac{index}", f"ac {index}", target_lower}
                    or target_lower[:32] in str(ref).lower()
                    for ref in (bug.get("acceptance_criteria_refs") or [])
                )
            ]
            ac_coverage_map.append({
                "reference": f"AC{index}: {target[:96]}",
                "status": status,
                "rationale": rationale,
                "related_bug_indexes": related_bug_indexes,
            })
            if status == "missing":
                missing_ac_recommendations.append(f"Add or clarify an acceptance criterion for: {target[:120]}")

        return {
            "issue_type_mode": issue_type_mode,
            "summary_headline": f"Generated {len(bugs)} finding{'s' if len(bugs) != 1 else ''} across {len(grouped_risks) or 1} risk theme{'s' if (len(grouped_risks) or 1) != 1 else ''}.",
            "highest_risk_area": highest_risk_area,
            "recommended_next_action": "Review the uncovered acceptance criteria first, then publish the highest-risk findings.",
            "grouped_risks": grouped_risks,
            "missing_ac_recommendations": missing_ac_recommendations[:5],
            "ac_coverage_map": ac_coverage_map,
        }
        
    async def generate_bug(
        self,
        context_text: str,
        current_fields_schema: list,
        issue_type_name: Optional[str] = None,
        model: str = None,
        user_description: str = None,
        custom_instructions: str = None,
        bug_count: Optional[int] = None,
        focus_bug_summary: Optional[str] = None,
        refinement_prompt: Optional[str] = None,
        supporting_context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        AI-assisted bug drafting. If user_description is provided, it maps that to the context.
        """
        # 1. Optimize Schema FIRST to prevent prompt bloat
        optimized_schema = self._clean_schema_for_ai(current_fields_schema)
        schema_json = json.dumps(optimized_schema)
        
        logger.info(
            "Optimized Jira schema for AI prompt original_chars=%s optimized_chars=%s",
            len(json.dumps(current_fields_schema)),
            len(schema_json),
        )

        issue_type_label = (issue_type_name or "Generic Story").strip()
        issue_type_lower = issue_type_label.lower()
        if any(keyword in issue_type_lower for keyword in ["api", "service", "backend", "integration"]):
            issue_type_mode = "API and backend reliability analysis"
        elif any(keyword in issue_type_lower for keyword in ["mobile", "ios", "android", "app"]):
            issue_type_mode = "Mobile workflow and device-context analysis"
        elif any(keyword in issue_type_lower for keyword in ["epic", "story", "feature", "user story"]):
            issue_type_mode = "User workflow and acceptance-criteria gap analysis"
        elif any(keyword in issue_type_lower for keyword in ["task", "subtask"]):
            issue_type_mode = "Implementation-task and regression-risk analysis"
        elif any(keyword in issue_type_lower for keyword in ["bug", "defect", "incident"]):
            issue_type_mode = "Root-cause and regression-expansion analysis"
        else:
            issue_type_mode = "General product-quality gap analysis"

        mode_instruction = ""
        target_bug_count = max(1, min(int(bug_count or 5), 10))

        if user_description:
            mode_instruction = f"""
            The user has manually described a bug they found: "{user_description}"
            Your primary goal is to structure this specific bug report using the story context below.
            Return exactly one bug in the bugs array.
            """
        elif focus_bug_summary or refinement_prompt:
            mode_instruction = f"""
            Refine or replace one existing draft finding.
            Current draft summary: "{focus_bug_summary or 'N/A'}"
            Refinement request: "{refinement_prompt or 'Improve clarity, specificity, and Jira readiness.'}"
            Return exactly one improved bug in the bugs array.
            """
        else:
            mode_instruction = """
            Analyze the story context and identify multiple distinct quality gaps.
            Return materially different bug candidates covering missing requirements, functional gaps, edge cases, and risks.
            Do not collapse all findings into one generic issue.
            """

        instruction_block = f"\nPERSONALITY & STYLE GUIDE: {custom_instructions}" if custom_instructions else ""

        system_prompt = f"""
        You are BugMind, a Senior QA Lead. 
        Your task is to synthesize a professional Jira bug report.
        {instruction_block}
        Active analysis mode: {issue_type_mode}
        
        {mode_instruction}
        
        REQUIREMENTS:
        - Each bug's "summary" must be a high-quality headline.
        - Each bug's "steps" must be a clean list of reproduction steps. YOU MUST PROVIDE STEPS.
        - Each bug's "expected" result must align with the acceptance criteria in the story.
        - Each bug's "actual" result must detail the observed deviation.
        - Each bug's "description" must be a professional summary of the problem and its impact (Core Findings), EXCLUDING the detailed steps, expected, or actual result sections as these are captured separately.
        - Each bug must include a "severity" from Critical, High, Medium, Low.
        - Each bug must include a "priority" from Highest, High, Medium, Low, Lowest.
        - Each bug must include a "confidence" integer from 0 to 100.
        - Each bug must include a "category" like Functional Gap, Edge Case, Validation, Permissions, Workflow, Data Integrity, UX, or Regression Risk.
        - Each bug must include "environment" describing the relevant platform, browser, or API context (e.g. "Web / Chrome 120+", "REST API / Production", "iOS 17 / Safari").
        - Each bug must include "root_cause" with a brief hypothesis of the probable root cause.
        - Each bug must include "acceptance_criteria_refs" as a short list of AC references or story sections that support the finding.
        - Each bug must include "evidence" as a short list of quoted or paraphrased signals from the story or user notes.
        - Each bug must include "suggested_evidence" as a short list of evidence the tester should collect (e.g. "Screenshot of error modal", "Network HAR capture", "Console log output").
        - Each bug must include "labels" as a list of 1-3 short tags (e.g. ["regression", "checkout", "validation"]).
        - Each bug must include "review_required" as true if confidence < 60 or the finding is speculative, false otherwise.
        - You must produce an "analysis_summary" object with:
          - "issue_type_mode"
          - "summary_headline"
          - "highest_risk_area"
          - "recommended_next_action"
          - "grouped_risks": grouped themes with count
          - "missing_ac_recommendations": concise AC additions or clarifications
          - "ac_coverage_map": coverage status for the main acceptance criteria or story expectations
        - Each bug's "custom_fields" dictionary: Only populate Jira fields shown in the schema below when you can confidently choose a valid value. Use the Jira field key as the dictionary key and a valid Jira value object/string as the value.

        CRITICAL:
        - YOU MUST PROVIDE VALUES FOR ALL CORE BUG FIELDS FOR EVERY BUG.
        - For Jira custom fields, do not invent fields or option values that are not present in the schema.
        - If "steps" are missing, use logic to create them.
        - If "expected" or "actual" results are not explicitly provided by the user, you MUST infer them based on the context.
        - NEVER return null or empty strings for these core fields.
        - Each bug in the bugs array must represent a distinct issue, not a rewording of another bug.
        - For analysis mode, return exactly {target_bug_count} bugs unless the story truly supports fewer distinct findings.
        - Avoid duplicate or overlapping findings. If two bugs are very similar, keep the stronger one only.

        The current Jira project expects these fields:
        {schema_json}
        
        OUTPUT FORMAT (JSON ONLY):
        {{
            "bugs": [
                {{
                    "summary": "Concise Bug Title",
                    "description": "*Summary*\\nConcise explanation of the defect and where it occurs.",
                    "steps": ["Step 1", "Step 2"],
                    "expected": "Expected behavior per the ACs",
                    "actual": "Actual observed deviation",
                    "severity": "High",
                    "priority": "High",
                    "confidence": 82,
                    "category": "Validation",
                    "environment": "Web / Chrome 120+ / Production",
                    "root_cause": "Missing server-side validation for edge case input",
                    "acceptance_criteria_refs": ["AC1", "Checkout flow"],
                    "evidence": ["Story requires X", "Acceptance criteria mention Y"],
                    "suggested_evidence": ["Screenshot of error state", "Network request log"],
                    "labels": ["validation", "checkout"],
                    "review_required": false,
                    "custom_fields": {{ "customfield_12345": {{ "id": "10001" }} }}
                }}
            ],
            "ac_coverage": 85.0,
            "warnings": ["Optional short warning if context is ambiguous"],
            "analysis_summary": {{
                "issue_type_mode": "{issue_type_mode}",
                "summary_headline": "Short executive summary",
                "highest_risk_area": "Most exposed workflow or domain",
                "recommended_next_action": "What the team should do next",
                "grouped_risks": [
                    {{
                        "group": "Validation",
                        "title": "Validation gaps",
                        "description": "What class of risk is under-specified",
                        "count": 2
                    }}
                ],
                "missing_ac_recommendations": [
                    "Add an acceptance criterion for invalid input handling"
                ],
                "ac_coverage_map": [
                    {{
                        "reference": "AC1",
                        "status": "partial",
                        "rationale": "Covered by the story, but error paths are missing",
                        "related_bug_indexes": [1, 2]
                    }}
                ]
            }}
        }}
        """

        fallback_prompt = f"""
        You are BugMind, a Senior QA Lead.
        Active analysis mode: {issue_type_mode}

        {mode_instruction}

        Return valid JSON only in this exact format:
        {{
            "bugs": [
                {{
                    "summary": "Concise Bug Title",
                    "description": "Professional summary of the problem and impact.",
                    "steps": ["Step 1", "Step 2"],
                    "expected": "Expected behavior",
                    "actual": "Actual behavior",
                    "severity": "High",
                    "confidence": 80,
                    "category": "Validation",
                    "acceptance_criteria_refs": ["AC1"],
                    "evidence": ["Signal from story"],
                    "custom_fields": {{}}
                }}
            ],
            "ac_coverage": 80.0,
            "warnings": []
        }}
        """

        try:
            truncated_context = self._truncate_context(self._sanitize_for_ai(context_text))
            user_prompt = f"Story Context:\n{truncated_context}"
            if user_description:
                user_prompt += f"\n\nUser's Bug Observation:\n{self._truncate_context(self._sanitize_for_ai(user_description), 2000)}"
            if supporting_context:
                user_prompt += f"\n\nSupporting Context:\n{self._truncate_context(self._sanitize_for_ai(supporting_context), 10000)}"
            try:
                return await self._generate_with_json_retry(system_prompt, user_prompt, model=model)
            except HTTPException as exc:
                if exc.status_code != 502:
                    raise
                simplified = await self._generate_with_json_retry(fallback_prompt, user_prompt, model=model)
                if not isinstance(simplified.get("bugs"), list):
                    raise
                simplified["analysis_summary"] = self._synthesize_analysis_summary(
                    simplified.get("bugs", []),
                    issue_type_mode,
                    context_text,
                )
                return simplified
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("AI bug generation failed")
            raise HTTPException(status_code=502, detail=f"AI Bug Generation Failed: {str(e)}")
