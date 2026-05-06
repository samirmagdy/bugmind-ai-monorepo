#!/bin/bash
# Validate environment configuration

echo "========================================"
echo "Environment Configuration Validation"
echo "========================================"
echo ""

# Check .env files
echo "Checking .env files..."
if [ -f ".env" ]; then
    echo "✓ Root .env exists"
else
    echo "✗ Root .env missing"
fi

if [ -f "backend/.env" ]; then
    echo "✓ Backend .env exists"
else
    echo "✗ Backend .env missing"
fi

echo ""
echo "Checking environment variables in root .env..."

mask_env_value() {
    local key="$1"
    if grep -q "^${key}=" .env; then
        echo "  ${key}=<set>"
    else
        echo "  Not set"
    fi
}

if [ -f ".env" ]; then
    echo "DATABASE_URL:"
    mask_env_value "DATABASE_URL"
    
    echo ""
    echo "OPENROUTER_API_KEY:"
    mask_env_value "OPENROUTER_API_KEY"
    
    echo ""
    echo "SECRET_KEY:"
    mask_env_value "SECRET_KEY"
fi

echo ""
echo "========================================"
echo "To deploy on Render:"
echo "1. Set DATABASE_URL in Render dashboard"
echo "2. Set OPENROUTER_API_KEY"  
echo "3. Set SECRET_KEY and ENCRYPTION_KEY"
echo "4. Push changes to trigger deploy"
echo "========================================"
