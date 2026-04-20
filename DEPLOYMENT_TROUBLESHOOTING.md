# Database Connection Troubleshooting Guide

## The Problem

```
psycopg.OperationalError: connection to server at "2a05:d018:135e:16e0:24f:5e52:49f6:bdde", port 5432 failed: Network is unreachable
```

This error means **Render cannot connect to your Supabase database**.

## Why This Happens

Supabase databases typically have **IP whitelist security** that:
1. Only allows connections from specific IP addresses
2. May not allow connections from cloud providers like Render
3. May block connections that don't come through their proxy

## Solutions

### Solution 1: Add Render's IP to Supabase Whitelist (BEST for Production)

1. **Find Render's outbound IPs:**
   - Render uses dynamic IPs, but they're in these ranges:
     - `35.232.0.0/14`
     - `52.208.0.0/13`
     - `104.131.0.0/16`

2. **In Supabase Dashboard:**
   - Go to Supabase → Project Settings → Database
   - Navigate to "Connection Pooling" or "IP Access Control"
   - Add these IPs or use `0.0.0.0/0` (allows all - less secure)

3. **More reliable approach - Use Supabase connection pooler:**
   - Supabase provides a connection pooler endpoint
   - Format: `postgresql://postgres:<password>@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require`

### Solution 2: Use Local Database for Development (QUICK FIX)

Change `.env` to use SQLite locally:
```env
DATABASE_URL=sqlite:///./bugmind.db
ENVIRONMENT=development
```

### Solution 3: Switch to a Cloud Database That Works with Render

Consider using:
- **Supabase + Connection Pooler** (requires configuration)
- **Railway.app** (if you're open to using Railway instead)
- **Neon.tech** (serverless PostgreSQL, works well with Render)
- **PlanetScale** (for MySQL)

## Immediate Fix: Make it Work

### Step 1: Check Supabase IP Whitelist

1. Go to Supabase Dashboard
2. Navigate to: Project Settings → Network Access
3. Look for IP whitelist/firewall rules
4. Add `0.0.0.0/0` to allow all IPs (for testing only)
   - Or add specific Render IP ranges

### Step 2: Use Connection Pooler (If Available)

Supabase connection pooler endpoint format:
```
postgresql://<db_user>:<db_password>@<cluster-id>.pooler.supabase.com:6543/postgres?sslmode=require
```

### Step 3: Test Database Connectivity

Run this locally to test:
```bash
python -c "
import psycopg2
try:
    conn = psycopg2.connect(
        'postgresql://postgres:wHPaodmXamPdxhZC@db.xafxmajodhawboezptcj.supabase.co:5432/postgres?sslmode=require'
    )
    print('Connection successful!')
    conn.close()
except Exception as e:
    print(f'Connection failed: {e}')
"
```

## Render-Specific Considerations

### Problem: Render's IPs change frequently
Render uses dynamic IPs that can change. You cannot reliably whitelist them.

### Better Approach: Use a Database-as-a-Service with Render Integration

**Option A: Use Neon.tech (Recommended)**
- Free tier PostgreSQL
- No IP whitelisting needed
- Works seamlessly with Render
- Auto-provisions connection from Render

**Option B: Use Supabase with Connection Pooling**
- Supabase has connection pooler feature
- Uses specific pooler endpoint instead of direct DB
- More reliable than direct connections

## Files You Need to Update

### 1. `/Users/samirmagdy/JBG 3/.env`
Update with the correct connection string based on your choice above.

### 2. `/Users/samirmagdy/JBG 3/backend/.env`
Update with the same connection string for consistency.

### 3. `/Users/samirmagdy/JBG 3/FIX_SUMMARY.md`
Update with your chosen solution.

## Testing Strategy

1. **Local testing first:**
   ```bash
   cd backend
   export DATABASE_URL="postgresql://..."
   python -c "from app.core.database import engine; print('DB connected')"
   ```

2. **Then deploy to Render** after verifying local connection works

3. **Check Render logs** for successful startup

## TL;DR - Quick Fix

1. **If using Supabase**: Enable connection pooling and use pooler endpoint
2. **If you want it simple**: Switch to Neon.tech (no IP whitelisting)
3. **For testing only**: Allow all IPs in Supabase (0.0.0.0/0)

## Current Database URL Format

Your current URL:
```
postgresql://postgres:wHPaodmXamPdxhZC@db.xafxmajodhawboezptcj.supabase.co:5432/postgres?sslmode=require
```

For Supabase with connection pooling, it should be:
```
postgresql://postgres.wHPaodmXamPdxhZC@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require
```

(Replace with your actual pooler endpoint from Supabase dashboard)
