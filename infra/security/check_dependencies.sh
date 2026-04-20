#!/bin/bash

# Dependency Guard: Automated Security Audit Utility
# This script checks for known vulnerabilities in Python and Extension dependencies.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}--- BugMind AI Dependency Guard Audit ---${NC}\n"

# 1. Backend (Python) Audit
echo -e "${YELLOW}[1/2] Auditing Backend Dependencies...${NC}"
if [ -f "backend/requirements.txt" ]; then
    echo "Found backend/requirements.txt. Checking for known vulnerabilities..."
    # We use a pattern-based check for common vulnerable versions 
    # since we cannot rely on external tools like safety/pip-audit being installed.
    
    # Example: Check for known old vulnerable FastAPI versions < 0.109.0
    grep -E "fastapi==0\.(0|10[0-8])\." backend/requirements.txt > /dev/null
    if [ $? -eq 0 ]; then
        echo -e "${RED}[!] WARNING: Potentially vulnerable FastAPI version detected.${NC}"
    else
        echo -e "${GREEN}✓ Backend core dependencies appear modern.${NC}"
    fi
else
    echo -e "${RED}[!] ERROR: backend/requirements.txt not found.${NC}"
fi

echo ""

# 2. Extension (Node.js) Audit
echo -e "${YELLOW}[2/2] Auditing Extension Dependencies...${NC}"
if [ -f "extension/package.json" ]; then
    echo "Found extension/package.json."
    
    if command -v npm &> /dev/null; then
        echo "Running 'npm audit' in extension folder..."
        npm audit --prefix extension
    else
        echo -e "${YELLOW}[!] 'npm' not found. Performing manual version check...${NC}"
        # Check for known vulnerable postcss < 8.4.33
        grep -E "\"postcss\": \"\^8\.4\.[0-2][0-9]\"" extension/package.json > /dev/null
        if [ $? -eq 0 ]; then
            echo -e "${RED}[!] WARNING: Potentially vulnerable PostCSS version detected in package.json.${NC}"
        else
            echo -e "${GREEN}✓ Extension core dependencies appear modern.${NC}"
        fi
    fi
else
    echo -e "${RED}[!] ERROR: extension/package.json not found.${NC}"
fi

echo -e "\n${GREEN}--- Audit Complete ---${NC}"
