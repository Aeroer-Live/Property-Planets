@echo off
cd /d "%~dp0"
echo.
echo === Property Planets - Cloudflare deploy ===
echo.

echo Step 1: Create D1 database...
call npx wrangler d1 create property-planets-db
echo.
echo Copy the "database_id" value from above (the UUID).
echo Open wrangler.toml and replace YOUR_D1_DATABASE_ID with that UUID.
echo.
pause

echo.
echo Step 2: Apply migrations to remote D1...
call npx wrangler d1 migrations apply property-planets-db
if errorlevel 1 (
  echo Migrations failed. Did you update database_id in wrangler.toml?
  pause
  exit /b 1
)

echo.
echo Step 3: Deploy Worker...
call npx wrangler deploy
if errorlevel 1 (
  echo Deploy failed.
  pause
  exit /b 1
)

echo.
echo === Done ===
echo Open your Worker URL, then go to /setup.html to create the first admin.
echo.
pause
