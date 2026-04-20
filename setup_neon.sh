#!/bin/bash
# Script to set up Neon.tech database (works with Render)

echo "=== Neon.tech Database Setup for Render ==="
echo ""

# Neon provides a connection string like:
# postgresql://username:password@ep-region-xyz.neon.tech/dbname?sslmode=require

echo "1. Go to https://neon.tech and sign up for free"
echo "2. Create a new PostgreSQL database"
echo "3. Copy the connection string from Neon dashboard"
echo ""
echo "Connection string format:"
echo "postgresql://<user>:<password>@aws-0-us-east-1.pooler.neon.tech:<port>/neondb?sslmode=require"
echo ""
echo "4. Update .env file with the Neon connection string:"
echo ""
echo "DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@ep-region-xyz.neon.tech/<port>/neondb?sslmode=require"
echo ""
echo "5. Push changes and redeploy to Render"
echo ""
echo "=== Benefits of Neon.tech ==="
echo "- No IP whitelisting needed"
echo "- Serverless PostgreSQL (scales automatically)"
echo "- Free tier generous"
echo "- Works seamlessly with Render"
echo "- Supports connection pooling"
echo ""
