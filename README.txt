Kostal Battery Homey App

A Homey app that integrates Kostal Plenticore and PIKO IQ inverters with the Homey smart home platform, enabling smart battery charging control based on electricity prices.

OVERVIEW
--------
This app connects your Kostal inverter to Homey, enabling you to monitor battery status and control grid charging through Homey flows and automations. It provides real-time battery status updates and supports automatic charging management based on day-ahead electricity prices from SMARD.

FEATURES
--------
• Battery Status Monitoring
  - State of Charge (SoC)
  - Battery power (W)
  - Battery voltage (V)
  - Battery current (A)
  - Charge cycles

• Smart Charging Control
  - Price-based charging: Automatically charge during cheapest electricity hours (SMARD API)
  - Configurable cheap blocks: Set how many 15-minute blocks per day to charge
  - Configurable expensive blocks: Set how many blocks to avoid grid usage
  - Manual override: Toggle charging on/off via Homey

• Time Control Schedule
  - Generates daily schedules based on electricity prices
  - "4" = charge from grid (cheapest blocks)
  - "2" = normal operation (medium price blocks)
  - "0" = avoid grid (expensive blocks)
  - Updates schedule only when changes detected (avoids unnecessary solar pauses)

• Real-time Updates
  - Battery status updates every 60 seconds
  - Schedule updates every 60 minutes
  - Next charging times displayed on device

REQUIREMENTS
------------
• Homey device running firmware >=12.4.0
• Kostal Plenticore or PIKO IQ inverter with battery
• Inverter accessible on local network
• Password for the "user" (Anlagenbetreiber) account

SETUP
-----
1. Install the app on your Homey device
2. Add the Kostal Battery device
3. Enter your inverter's IP address and password during pairing
4. Configure charging preferences in device settings:
   - Target SoC (default: 80%)
   - Minimum SoC (default: 10%)
   - Charging power in watts (default: 4000W)
   - Number of cheapest blocks to charge (default: 8 = 2 hours)
   - Number of expensive blocks to avoid (default: 8 = 2 hours)

DEVICE SETTINGS
---------------
• Connection:
  - IP Address: Your inverter's local IP (e.g., 192.168.1.100)
  - Password: Password for the "user" account

• Charging Settings:
  - Minimum SoC: Battery won't discharge below this level
  - Target SoC: Target charge level when grid charging
  - Charging Power: Watts to draw from grid

• Low Price Charging:
  - Enable Low Price Charging: Toggle automatic price-based scheduling
  - Cheapest Blocks: Number of 15-min blocks to charge (value "4")
  - Expensive Blocks: Number of 15-min blocks to avoid (value "0")
  - Timezone: For price time display (auto-detected if empty)

TECHNICAL DETAILS
-----------------
• API: Kostal Plenticore/PIKO IQ REST API (/api/v1)
• Authentication: SCRAM-SHA256
• Session Management: Automatic re-authentication on session expiry
• Price Data: SMARD API (DE-LU day-ahead prices)
• Update Intervals: 60s (status), 60min (schedule)
• SDK: Homey SDK 3

SCHEDULE VALUES
---------------
The app sets the inverter's Battery:TimeControl:Conf* settings:
• "4" = Charge from grid and preserve battery for home
• "2" = Normal automatic operation
• "0" = Do not charge from grid

LICENSE
-------
See LICENSE file for details.
