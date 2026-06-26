import requests

UKG_BASE = "https://secure7.saashr.com"

CLIENT_ID = "YOUR_CLIENT_ID"
CLIENT_SECRET = "YOUR_CLIENT_SECRET"

response = requests.post(
    f"{UKG_BASE}/oauth2/token",
    data={
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
    },
    timeout=30,
)

print("Status:", response.status_code)
print("Response:", response.text)


Invoke-RestMethod -Method POST "https://secure7.saashr.com/oauth2/token" `
-Headers @{ "Content-Type" = "application/x-www-form-urlencoded" } `
-Body "grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET"
