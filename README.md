# mavlink-googleapis

Mavlink over Google Cloud IoT Core MQTT using NodeJS.

### Setup:
1. `git clone https://github.com/ValentineStone/mavlink-googleapis`
2. `cd mavlink-googleapis`
3. `npm i`
4. `cp .env.example .env` and change it according to your setup
5. `node service device` to connect serialport to Google IoT using MAVLink 2  
   `node service device-udp` to connect udp to Google IoT using MAVLink 2  
   `node service master` to connect Google IoT to GCS over udp using MAVLink 2  
   `node udp-serial` to connect udp to serial directly (does not use Google IoT)

### To generate keys
```
openssl ecparam -genkey -name prime256v1 -noout -out ec_private.pem
openssl ec -in ec_private.pem -pubout -out ec_public.pem
```
