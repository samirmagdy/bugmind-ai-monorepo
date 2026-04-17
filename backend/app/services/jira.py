import httpx
import base64
import ssl
import logging
from typing import Optional, Dict, Any, List
from pydantic import HttpUrl

class JiraConnectionError(Exception):
    """Custom exception for Jira connection issues (SSL, Timeout, Host unreachable)."""
    def __init__(self, message: str, original_error: Optional[Exception] = None):
        super().__init__(message)
        self.original_error = original_error

class JiraService:
    # Class-level cache to remember which search parameter works for a given base_url
    # (base_url) -> successful_param_name
    _SEARCH_PARAM_CACHE = {}
    
    def __init__(self, base_url: str, auth_type: str, token: str, username: Optional[str] = None, verify_ssl: bool = True):
        self.logger = logging.getLogger("bugmind")
        self.base_url = base_url.rstrip("/")
        self.auth_type = auth_type
        self.token = token
        self.username = username
        self.verify_ssl = verify_ssl
        self.headers = self._get_headers()

    @property
    def api_path(self):
        """Dynamic API versioning based on deployment type."""
        return f"/rest/api/{'3' if self.auth_type == 'cloud' else '2'}"

    async def get_deployment_type(self) -> str:
        """Call serverInfo to determine if this is Jira Cloud or Server/DC."""
        url = f"{self.base_url}/rest/api/2/serverInfo"
        try:
            res = await self._make_request("GET", url)
            if res.status_code == 200:
                data = res.json()
                dtype = data.get("deploymentType", "Server").lower()
                return "cloud" if dtype == "cloud" else "server"
        except Exception as e:
            self.logger.warning(f"[JIRA] Platform discovery failed: {e}")
        return self.auth_type

    def _get_headers(self, auth_override: Optional[str] = None) -> Dict[str, str]:
        headers = {
            "Accept": "application/json", 
            "Content-Type": "application/json",
            "X-Atlassian-Token": "no-check",
            "User-Agent": "BugMind-AI-Extension/1.0"
        }
        
        auth_header = auth_override
        if not auth_header:
            if self.auth_type == "cloud":
                auth_str = f"{self.username}:{self.token}"
                encoded_auth = base64.b64encode(auth_str.encode()).decode()
                auth_header = f"Basic {encoded_auth}"
            else:
                if self.username and self.token:
                    auth_str = f"{self.username}:{self.token}"
                    encoded_auth = base64.b64encode(auth_str.encode()).decode()
                    auth_header = f"Basic {encoded_auth}"
                else:
                    auth_header = f"Bearer {self.token}"
        
        headers["Authorization"] = auth_header
        return headers

    def _to_adf(self, text: str) -> Dict[str, Any]:
        """Convert plain text to Atlassian Document Format (ADF) for Jira Cloud v3."""
        if not text:
            return {"version": 1, "type": "doc", "content": []}
            
        paragraphs = []
        for line in text.split('\n'):
            if line.strip():
                paragraphs.append({
                    "type": "paragraph",
                    "content": [{"type": "text", "text": line}]
                })
        
        return {
            "version": 1,
            "type": "doc",
            "content": paragraphs
        }

    async def _make_request(self, method: str, url: str, **kwargs) -> httpx.Response:
        """Centralized request handler with multi-auth retries and session caching."""
        # Try cached working header first
        headers = self.headers.copy()
        if hasattr(self, "_working_auth"):
            headers["Authorization"] = self._working_auth
        
        # Use a generous 30s timeout to accommodate cold starts or slow Jira Cloud instances
        timeout = httpx.Timeout(30.0, connect=10.0)
        # Force IPv4 to bypass broken IPv6/NAT64 paths on certain networks
        transport = httpx.AsyncHTTPTransport(local_address="0.0.0.0")
        async with httpx.AsyncClient(verify=self.verify_ssl, follow_redirects=True, timeout=timeout, transport=transport) as client:
            try:
                self.logger.info(f"[JIRA-OUT] {method} {url}")
                res = await client.request(method, url, headers=headers, **kwargs)
                self.logger.info(f"[JIRA-IN]  {method} {url} -> {res.status_code}")
                
                if res.status_code != 401 or self.auth_type != "server":
                    if res.status_code == 200:
                        self._working_auth = headers["Authorization"]
                    return res
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.WriteTimeout) as e:
                error_type = type(e).__name__
                error_msg = str(e) or "Timeout/Connection failed"
                if "CERTIFICATE_VERIFY_FAILED" in error_msg or "certificate has expired" in error_msg.lower():
                    raise JiraConnectionError(
                        "SSL Verification failed. If your Jira server uses a self-signed or expired certificate, please disable 'Verify SSL' in connection settings.",
                        original_error=e
                    )
                raise JiraConnectionError(f"Failed to connect to Jira ({error_type}): {error_msg}", original_error=e)
            except Exception as e:
                print(f"[JIRA] Request failed: {e}")
                raise e

            # Server-specific Auth Retries
            print("[JIRA] 401 detected, trying alternative auth...")
            
            auth_methods = []
            # Method A: Bearer PAT
            auth_methods.append(f"Bearer {self.token}")
            # Method B: Basic Token-only
            auth_str_token = f":{self.token}"
            auth_methods.append(f"Basic {base64.b64encode(auth_str_token.encode()).decode()}")
            # Method C: Original Basic (if not already tried)
            if self.username:
                auth_str_orig = f"{self.username}:{self.token}"
                auth_methods.append(f"Basic {base64.b64encode(auth_str_orig.encode()).decode()}")

            for auth in auth_methods:
                if auth == headers["Authorization"]: continue
                print(f"[JIRA] Retrying with alternative auth: {auth[:20]}...")
                headers["Authorization"] = auth
                res = await client.request(method, url, headers=headers, **kwargs)
                if res.status_code == 200:
                    print(f"[JIRA] Success with {auth[:10]}! Caching for session.")
                    self._working_auth = auth
                    return res
            
            return res

    async def get_issue(self, issue_key: str) -> Dict[str, Any]:
        url = f"{self.base_url}{self.api_path}/issue/{issue_key}"
        res = await self._make_request("GET", url)
        res.raise_for_status()
        return res.json()

    async def link_issues(self, outward_key: str, inward_key: str, link_type: str = "Relates"):
        """Link two issues together (e.g. Bug relates to User Story)."""
        url = f"{self.base_url}/rest/api/2/issueLink"
        payload = {
            "type": { "name": link_type },
            "inwardIssue": { "key": inward_key },
            "outwardIssue": { "key": outward_key }
        }
        res = await self._make_request("POST", url, json=payload)
        if res.status_code != 201:
            print(f"[JIRA] Failed to link issues {outward_key} -> {inward_key}: {res.text}")
            # We don't raise here to avoid failing the whole creation if linking fails
            return False
        return True

    async def create_issue(self, project_key: str, summary: str, description: str, issue_type: str = "Bug", extra_fields: Optional[Dict[str, Any]] = None, project_id: Optional[str] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{self.api_path}/issue"
        project_ref = {"id": project_id} if project_id else {"key": project_key}
        
        # Format payload for v3 (Cloud) vs v2 (Server)
        is_v3 = self.auth_type == "cloud"
        
        payload = {
            "fields": {
                "project": project_ref,
                "summary": summary,
                "description": self._to_adf(description) if is_v3 else description,
                "issuetype": {"name": issue_type}
            }
        }
        
        if extra_fields:
            # Clean up redundant project/issuetype
            extra_fields.pop("project", None)
            extra_fields.pop("issuetype", None)
            
            # Extract and handle priority separately based on platform requirements
            priority_override = extra_fields.pop("priority", None)
            if priority_override:
                priority_name = priority_override.get("name") if isinstance(priority_override, dict) else priority_override
                if priority_name:
                    # Cloud v3 strictly requires string format for priority
                    # Server v2 prefers object {"name": "High"}
                    payload["fields"]["priority"] = priority_name if is_v3 else {"name": priority_name}
            
            # Merge remaining extra fields
            payload["fields"].update(extra_fields)

        # FINAL NORMALIZATION PASS (Applied globally to both Cloud and Server)
        # 1. Multi-select identity fields (components, versions, fixVersions)
        # These MUST be [{"name": "val"}] instead of ["val"]
        multi_select_fields = ["components", "versions", "fixVersions"]
        for field in multi_select_fields:
            if field in payload["fields"]:
                val = payload["fields"][field]
                if isinstance(val, list):
                    normalized = []
                    for item in val:
                        if isinstance(item, str):
                            normalized.append({"name": item})
                        else:
                            normalized.append(item)
                    payload["fields"][field] = normalized
                elif isinstance(val, str):
                    payload["fields"][field] = [{"name": val}]

        # 2. Priority Cloud Normalization (Ensuring string format if v3)
        if is_v3 and "priority" in payload["fields"]:
            p = payload["fields"]["priority"]
            if isinstance(p, dict) and "name" in p:
                payload["fields"]["priority"] = p["name"]
        
        res = await self._make_request("POST", url, json=payload)
        if res.status_code != 201:
            raise Exception(f"Failed to create issue ({res.status_code}): {res.text}")
        return res.json()

    async def get_project_components(self, project_key: str, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        target = project_id if project_id else project_key
        url = f"{self.base_url}{self.api_path}/project/{target}/components"
        res = await self._make_request("GET", url)
        return res.json() if res.status_code == 200 else []

    async def get_project_versions(self, project_key: str, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        target = project_id if project_id else project_key
        url = f"{self.base_url}{self.api_path}/project/{target}/versions"
        res = await self._make_request("GET", url)
        return res.json() if res.status_code == 200 else []

    async def get_project_issue_types(self, project_key: str, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Fetch available issue types with permissive fallback."""
        # 1. Permissive Project Endpoint
        target = project_id if project_id else project_key
        url = f"{self.base_url}{self.api_path}/project/{target}"
        res = await self._make_request("GET", url)
        if res.status_code == 200:
            types = res.json().get("issueTypes", [])
            if types: return types

        # 2. Global Fallback
        url_global = f"{self.base_url}{self.api_path}/issuetype"
        res_global = await self._make_request("GET", url_global)
        if res_global.status_code == 200:
            return res_global.json()

        return []

    async def get_priorities(self) -> List[Dict[str, Any]]:
        """Fetch global Jira priorities."""
        url = f"{self.base_url}{self.api_path}/priority"
        res = await self._make_request("GET", url)
        if res.status_code == 200:
            return [{"id": p["id"], "name": p["name"]} for p in res.json()]
        return []

    async def get_assignable_users(self, project_key: str, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Fetch users assignable to a specific project (default list)."""
        target = project_id if project_id else project_key
        url = f"{self.base_url}{self.api_path}/user/assignable/search?project={target}&maxResults=10"
        res = await self._make_request("GET", url)
        if res.status_code == 200:
            users = res.json()
            return [
                {
                    "id": u.get("accountId") or u.get("name") or u.get("key"), 
                    "name": u.get("displayName"),
                    "avatar": u.get("avatarUrls", {}).get("24x24")
                } 
                for u in users
            ]
        return []

    async def search_assignable_users(self, project_key: str, query: str, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Search for users assignable to a specific project with platform-specific optimizations."""
        is_cloud = self.auth_type == "cloud"
        
        # 1. Determine optimal targets and params based on Platform
        # Cloud prefers ID and 'query'. Server prefers Key and 'username'.
        targets = []
        if is_cloud:
            if project_id: targets.append(project_id)
            if project_key: targets.append(project_key)
        else:
            if project_key: targets.append(project_key)
            if project_id: targets.append(project_id)
            
        # Cloud strictly requires 'query'. Server prefers 'username' but allows 'query'.
        params = ["query"] if is_cloud else ["username", "query"]
        
        # Optimization: Move last successful param to front
        best_param = self._SEARCH_PARAM_CACHE.get(self.base_url)
        if best_param and best_param in params:
            params.remove(best_param)
            params.insert(0, best_param)

        def map_users(users_list):
            if not users_list or not isinstance(users_list, list): return []
            return [
                {
                    # ACCOUNT_ID for Cloud, NAME/KEY for Server
                    "id": u.get("accountId") if is_cloud else (u.get("name") or u.get("key") or u.get("accountId")), 
                    "name": u.get("displayName"),
                    "avatar": u.get("avatarUrls", {}).get("24x24")
                } 
                for u in users_list if u.get("displayName")
            ]

        # PHASE 1: Targeted Assignable Search
        for target in targets:
            for p_name in params:
                url = f"{self.base_url}{self.api_path}/user/assignable/search?project={target}&{p_name}={query}&maxResults=10"
                msg = f"[USER-SEARCH] [{self.auth_type.upper()}] Trying ASSIGNABLE: target={target}, param={p_name}"
                self.logger.info(msg)
                try:
                    res = await self._make_request("GET", url)
                    if res.status_code == 200:
                        matched = map_users(res.json())
                        if matched:
                            self.logger.info(f"[USER-SEARCH] Success: Found {len(matched)} users")
                            self._SEARCH_PARAM_CACHE[self.base_url] = p_name
                            return matched
                except Exception as e:
                    print(f"[USER-SEARCH] Phase 1 error: {e}")

        # PHASE 2: Global Fallback Search
        self.logger.info(f"[USER-SEARCH] No assignable results. Trying GLOBAL search for {query}...")
        for p_name in params:
            # Skip username on cloud global search (fixes 400 Bad Request)
            if is_cloud and p_name == "username": continue
            
            url = f"{self.base_url}{self.api_path}/user/search?{p_name}={query}&maxResults=10"
            try:
                res = await self._make_request("GET", url)
                if res.status_code == 200:
                    matched = map_users(res.json())
                    if matched:
                        print(f"[USER-SEARCH] Success: Found {len(matched)} users via GLOBAL fallback")
                        return matched
            except Exception as e:
                print(f"[USER-SEARCH] Global search failed: {e}")
        
        return []

    async def get_project_sprints(self, project_key: str, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Fetch active and future sprints for a project via the Agile API."""
        try:
            # 1. Find board for project
            target = project_id if project_id else project_key
            board_url = f"{self.base_url}/rest/agile/1.0/board?projectKeyOrId={target}"
            print(f"[JIRA-AGILE] Searching boards for {target}: {board_url}")
            res_board = await self._make_request("GET", board_url)
            if res_board.status_code != 200:
                print(f"[JIRA-AGILE] Board search failed: {res_board.status_code}")
                return []
            
            boards = res_board.json().get("values", [])
            if not boards:
                print(f"[JIRA-AGILE] No boards found for project {project_key}")
                return []
            
            # Use the first board (usually the main one)
            board_id = boards[0]["id"]
            print(f"[JIRA-AGILE] Found board {board_id} ({boards[0].get('name')})")
            
            # 2. Get sprints for that board
            sprint_url = f"{self.base_url}/rest/agile/1.0/board/{board_id}/sprint?state=active,future"
            res_sprint = await self._make_request("GET", sprint_url)
            if res_sprint.status_code == 200:
                sprints = res_sprint.json().get("values", [])
                print(f"[JIRA-AGILE] Found {len(sprints)} active/future sprints")
                return [{"id": str(s["id"]), "name": s["name"]} for s in sprints]
            else:
                print(f"[JIRA-AGILE] Sprint fetch failed for board {board_id}: {res_sprint.status_code}")
        except Exception as e:
            print(f"[JIRA-AGILE] Sprint fetch failed: {e}")
            
        return []

    async def get_createmeta_v3(self, project_key: str, issue_type_id: Optional[str] = None, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Jira Cloud v3 Strategy."""
        # 1. Get Project ID
        pid = project_id
        if not pid:
            url_proj = f"{self.base_url}/rest/api/3/project/{project_key}"
            res_proj = await self._make_request("GET", url_proj)
            if res_proj.status_code != 200: return []
            pid = res_proj.json()["id"]

        selected_it_id = issue_type_id
        if not selected_it_id:
            # 2. Get issue types to find Bug fallback
            url_it = f"{self.base_url}/rest/api/3/issue/createmeta/{project_id}/issuetypes"
            res_it = await self._make_request("GET", url_it)
            if res_it.status_code != 200: return []
            issue_types = res_it.json().get("issueTypes", [])
            bug_type = self._find_best_issue_type(issue_types)
            if not bug_type: return []
            selected_it_id = bug_type['id']

        # 3. Get fields
        url_fields = f"{self.base_url}/rest/api/3/issue/createmeta/{pid}/issuetypes/{selected_it_id}"
        res_fields = await self._make_request("GET", url_fields)
        return res_fields.json().get("fields", []) if res_fields.status_code == 200 else []

    async def get_createmeta(self, project_key: str, issue_type_id: Optional[str] = None, issue_type_name: str = "Bug", project_id: Optional[str] = None) -> Dict[str, Any]:
        """Unified metadata fetcher with multi-auth retries and granular fallbacks."""
        # Strategy 1: Cloud v3
        if self.auth_type == "cloud":
            try:
                fields = await self.get_createmeta_v3(project_key, issue_type_id, project_id=project_id)
                if fields: return fields
            except: pass

        # Strategy 2: Modern Granular Metadata (Server/DC v8.4+)
        # This is often active when the bulk search endpoint is disabled
        if issue_type_id:
            target = project_id if project_id else project_key
            url_granular = f"{self.base_url}/rest/api/2/issue/createmeta/{target}/issuetypes/{issue_type_id}"
            try:
                res = await self._make_request("GET", url_granular)
                print(f"[JIRA] Strategy 2 Response: {res.status_code}")
                if res.status_code == 200:
                    data = res.json()
                    print(f"[JIRA] Strategy 2 JSON Keys: {list(data.keys()) if isinstance(data, dict) else 'is-list'}")
                    
                    # Log the first 200 chars of the body for deep diagnosis
                    raw_text = res.text
                    print(f"[JIRA] Strategy 2 Body Sample: {raw_text[:200]}")

                    fields = None
                    if isinstance(data, dict):
                        fields = data.get("fields")
                        if not fields and "values" in data and isinstance(data["values"], list) and len(data["values"]) > 0:
                            # IMPORTANT: Check if the first value is a field object or an issue type container
                            first_val = data["values"][0]
                            if "fields" in first_val:
                                fields = first_val.get("fields")
                            else:
                                # In some Jira Server versions, 'values' IS the list of fields
                                fields = data["values"]
                        
                        if not fields and "issuetypes" in data and isinstance(data["issuetypes"], list) and len(data["issuetypes"]) > 0:
                            fields = data["issuetypes"][0].get("fields")
                        
                        # LAST DITCH for Strategy 2: dictionary of fields
                        if not fields and len(data) > 3 and "id" not in data and "name" not in data:
                             fields = data
                    
                    if fields:
                        print(f"[JIRA] Strategy 2 Found {len(fields)} fields")
                        return fields
                    else:
                        print("[JIRA] Strategy 2 returned 200 but no fields found in structural search")
            except Exception as e:
                print(f"[JIRA] Strategy 2 failed: {e}")

        # Strategy 3: Legacy Bulk Createmeta
        if project_id:
            url = f"{self.base_url}/rest/api/2/issue/createmeta?projectIds={project_id}&expand=projects.issuetypes.fields"
        else:
            url = f"{self.base_url}/rest/api/2/issue/createmeta?projectKeys={project_key}&expand=projects.issuetypes.fields"
            
        if issue_type_id:
            url += f"&issueTypeIds={issue_type_id}"
        elif issue_type_name:
            url += f"&issueTypeNames={issue_type_name}"
            
        res = await self._make_request("GET", url)
        if res.status_code == 200:
            projects = res.json().get("projects", [])
            if projects:
                issue_types = projects[0].get("issuetypes", [])
                target = None
                if issue_type_id:
                    target = next((it for it in issue_types if str(it.get("id")) == str(issue_type_id)), None)
                if not target and issue_type_name:
                    target = self._find_best_issue_type(issue_types, issue_type_name)
                
                if target:
                    return target.get("fields", {})
        
        return {}

    def _find_best_issue_type(self, issue_types: List[Dict[str, Any]], target_name: str = "Bug") -> Optional[Dict[str, Any]]:
        """Finds the best matching issue type for bug reporting."""
        # 1. Exact match (case-insensitive)
        target = next((it for it in issue_types if it["name"].lower() == target_name.lower()), None)
        if target: return target
        
        # 2. Partial match (e.g. "Software Bug", "Bug Ticket")
        target = next((it for it in issue_types if target_name.lower() in it["name"].lower()), None)
        if target: return target
        
        # 3. Fallback to the first available issue type
        if issue_types:
            print(f"Fallback: No '{target_name}' type found, using '{issue_types[0]['name']}'")
            return issue_types[0]
        
        return None

    @staticmethod
    def extract_ac(description: str) -> str:
        return description
