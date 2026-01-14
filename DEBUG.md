# Debugging Kostal Battery Homey App

## Accessing Logs

### 1. Homey App (Mobile/Tablet)
- Open Homey app
- Go to **Settings** → **Apps** → **Kostal Battery** → **Logs**
- Or **Settings** → **Developer** → **Logs** (if developer mode enabled)

### 2. Homey Web Interface
- Open `http://homey.local` (or your Homey's IP address)
- Go to **Settings** → **Apps** → **Kostal Battery** → **Logs**
- Or **Settings** → **Developer** → **Logs**

### 3. Development Mode
```bash
# Run app with live logging
cd tools.favo.homey.battery
npm run build
homey app run --remote
```

### 4. SSH Access (if enabled)
```bash
# SSH into your Homey
ssh root@homey.local

# View app logs
homey app log --app tools.favo.homey.battery

# Follow logs in real-time
homey app log --app tools.favo.homey.battery --follow

# View system logs for the app
journalctl -u homey-app-tools.favo.homey.battery -f
```

## Log Prefixes

The app uses prefixed log messages for easy filtering:

| Prefix | Description |
|--------|-------------|
| `[INIT]` | Device initialization |
| `[STATUS]` | Battery status updates |
| `[POLLING]` | Polling interval events |
| `[SESSION]` | SCRAM authentication and session management |
| `[PRICE]` | Price data fetching and processing |
| `[SCHEDULE]` | Schedule building and application |
| `[SETTINGS]` | Settings changes |
| `[ONOFF]` | Manual on/off control |
| `[CHARGING]` | Charging state changes |
| `[PAIR]` | Device pairing |

## Common Log Patterns

### Successful Operation
```
[PRICE] Fetching prices... (cheapest=8, expensive=8, tz=Europe/Berlin)
[PRICE] Received 192 price entries from SMARD
[PRICE] Price range: 45.23 - 98.76 EUR/MWh
[PRICE] Found 8 cheapest blocks (wanted 8)
[PRICE] Next cheap times: 02:00 (45.23), 02:15 (46.10), 03:00 (47.50)...
[SCHEDULE] Building price-based schedule...
[SCHEDULE] TUE: 8 charge blocks, 8 avoid blocks, 80 normal blocks
[SCHEDULE] Changes detected: schedule
[SCHEDULE] Applying to inverter... (soc=80%, power=4000W, minSoc=10%)
[SCHEDULE] Successfully applied: MON:8ch/80n/8av TUE:8ch/80n/8av ...
```

### No Changes (Schedule Skipped)
```
[SCHEDULE] No changes detected, skipping API call (avoiding solar pause)
```

### Authentication
```
[SESSION] Performing SCRAM authentication...
[SESSION] SCRAM authentication successful, session cached.
```

### Session Recovery
```
[SESSION] Auth error detected, re-authenticating...
[SESSION] Session invalidated.
[SESSION] SCRAM authentication successful, session cached.
```

## Common Issues

### 1. Connection Failed During Pairing
**Symptoms**: Error message during device setup
**Causes**:
- Wrong IP address
- Wrong password
- Inverter not accessible on network
- Firewall blocking connection

**Solutions**:
- Verify IP address is correct (check inverter's web interface)
- Verify password for "user" account
- Check network connectivity
- Ensure Homey and inverter are on same network

### 2. Authentication Errors
**Symptoms**: `[SESSION] SCRAM authentication failed`
**Causes**:
- Incorrect password
- Account locked
- Session limit reached on inverter

**Solutions**:
- Verify password in device settings
- Wait a few minutes and retry
- Restart inverter if persistent

### 3. No Price Data
**Symptoms**: `[PRICE] No price data available!`
**Causes**:
- SMARD API unavailable
- Network issues
- Time/date issues

**Solutions**:
- Check internet connectivity on Homey
- Wait for next update cycle
- Check SMARD API status

### 4. Schedule Not Applied
**Symptoms**: Schedule shown in logs but inverter not updated
**Causes**:
- `[SCHEDULE] No changes detected` - This is normal!
- Authentication error
- API error

**Solutions**:
- Check if changes were actually needed
- Look for error messages after schedule build
- Verify session is valid

### 5. Solar Production Pauses
**Symptoms**: Brief solar production drops when schedule updates
**Causes**:
- This is normal Kostal behavior when settings change
- Too frequent updates

**Solutions**:
- App already optimizes by only updating when changes detected
- Increase update interval if needed

## Debug Checklist

- [ ] Check Homey app logs for error messages
- [ ] Verify inverter IP is accessible (`ping 192.168.x.x`)
- [ ] Test inverter web interface works
- [ ] Verify password is correct
- [ ] Check if `enable_low_price_charging` is enabled
- [ ] Look for `[SCHEDULE]` log messages
- [ ] Check for authentication errors
- [ ] Verify timezone setting

## Getting Help

When reporting issues, include:
1. Full log output (filtered by `[PRICE]`, `[SCHEDULE]`, `[SESSION]`)
2. Device settings (without password)
3. When the issue occurs
4. Expected vs actual behavior
5. Homey version
6. Inverter model and firmware version
