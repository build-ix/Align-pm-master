#!/bin/bash

# Get a valid token first
TOKEN=$(curl -s -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Alfredo25"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "✗ Failed to get auth token"
  exit 1
fi

echo "✓ Got auth token"

# Get project ID
PID=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3002/api/projects | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$PID" ]; then
  echo "✗ No projects found"
  exit 1
fi

echo "✓ Got project ID: $PID"

# Create a private list
PRIVATE=$(curl -s -X POST http://localhost:3002/api/projects/$PID/punchlist-lists \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Private Test","privacy":"private"}')

echo "✓ Created private list:"
echo "$PRIVATE" | grep -o '"id":"[^"]*' | head -1

# Create a public list
PUBLIC=$(curl -s -X POST http://localhost:3002/api/projects/$PID/punchlist-lists \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Public Test","privacy":"public"}')

echo "✓ Created public list:"
echo "$PUBLIC" | grep -o '"id":"[^"]*' | head -1

# List all punchlist lists (should see both if creator)
echo ""
echo "✓ Listing all lists (as creator):"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3002/api/projects/$PID/punchlist-lists | jq '.lists[] | {id, name, privacy}' 2>/dev/null || curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3002/api/projects/$PID/punchlist-lists

