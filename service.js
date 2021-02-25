require('dotenv/config')

if (process.argv[2] === 'serial-udp')
  return require('./serial-udp')

const iot = require('@google-cloud/iot')
const { readFileSync } = require('fs')
const jwt = require('jsonwebtoken')
const mqtt = require('mqtt')
const uuid = require('uuid')
const uuid_namespace = 'e72bc52c-7700-11eb-9439-0242ac130002'
const { throttleBuffer, persist, pair_uuid } = require('./utils')
const googleCredentials = require(process.env.GOOGLE_APPLICATION_CREDENTIALS)

// Pull from environment
const publicKeyFile = process.env.PUBLIC_KEY_FILE
const privateKeyFile = process.env.PRIVATE_KEY_FILE
const publicKey = readFileSync(publicKeyFile).toString()

const projectId = googleCredentials.project_id
const cloudRegion = process.env.CLOUD_REGION
const registryId = 'mavlink-googleapis-proxy-pairs'
const pairId = 'pair-' + uuid.v5(publicKey, uuid_namespace)
const deviceId = pairId + '-device'
const proxyId = pairId + '-proxy'
const bufferAccumulatorSize = +process.env.BUFFER_ACCUMULATOR_SIZE
const bufferAccumulatorTTL = +process.env.BUFFER_ACCUMULATOR_TTL
const stub = !!process.env.STUB
const connectionKeepAlive = +process.env.PAIR_CONNECTION_KEEPALIVE
const connectionPing = +process.env.PAIR_CONNECTION_PING
const commandsSubfolder = 'mavlink2'
const pingSubfolder = 'ping'

const algorithm = 'ES256'
const mqttBridgeHost = 'mqtt.googleapis.com'
const mqttBridgePort = 8883

const iotClient = new iot.v1.DeviceManagerClient()

const catchAlreadyExists = e => {
  if (e.code === 6); // A resource with that parent and ID already exists
  else throw e
}

const ignoreErrors = error => undefined

async function ensureRegistry() {
  await iotClient.createDeviceRegistry({
    parent: iotClient.locationPath(projectId, cloudRegion),
    deviceRegistry: { id: registryId },
  }).catch(catchAlreadyExists)
}

async function ensureDevice(deviceId) {
  await iotClient.createDevice({
    parent: iotClient.registryPath(projectId, cloudRegion, registryId),
    device: {
      id: deviceId,
      credentials: [{
        publicKey: {
          format: 'ES256_PEM',
          key: publicKey,
        },
      }],
    },
  }).catch(catchAlreadyExists)
}

async function ensurePair() {
  await ensureRegistry()
  await ensureDevice(deviceId)
  await ensureDevice(proxyId)
}

const createJwt = (projectId, privateKeyFile, algorithm) => {
  // Create a JWT to authenticate this device. The device will be disconnected
  // after the token expires, and will have to reconnect with a new token. The
  // audience field should always be set to the GCP project id.
  const token = {
    iat: parseInt(Date.now() / 1000),
    exp: parseInt(Date.now() / 1000) + 60 * 60 * 24, // 1 day (max)
    aud: projectId,
  }
  const privateKey = readFileSync(privateKeyFile)
  return jwt.sign(token, privateKey, { algorithm })
}

async function mqttConnect(registryId, deviceId) {
  const mqttClientId = iotClient.devicePath(
    projectId, cloudRegion, registryId, deviceId)
  // With Google Cloud IoT Core, the username field is ignored, however it must
  // be non-empty. The password field is used to transmit a JWT to authorize the
  // device. The "mqtts" protocol causes the library to connect using SSL, which
  // is required for Cloud IoT Core.
  const connectionArgs = {
    host: mqttBridgeHost,
    port: mqttBridgePort,
    clientId: mqttClientId,
    username: 'unused',
    password: createJwt(projectId, privateKeyFile, algorithm),
    protocol: 'mqtts',
    secureProtocol: 'TLSv1_2_method',
  }

  // Create a client, and connect to the Google MQTT bridge.
  const client = mqtt.connect(connectionArgs)

  return await new Promise((resolve, reject) => {
    client.on('connect', () => resolve(client))
    client.on('close', () => reject(new Error('Connection closed')))
    client.on('error', reject)
  })
}

const emptyBuffer = Buffer.from([0])
async function createController(localDevice, remoteDevice) {
  const client = await mqttConnect(registryId, localDevice)
  client.subscribe(`/devices/${localDevice}/commands/#`, { qos: 0 })
  const remotePath = iotClient.devicePath(
    projectId,
    cloudRegion,
    registryId,
    remoteDevice
  )
  const ping = () => iotClient.sendCommandToDevice({
    name: remotePath,
    binaryData: emptyBuffer,
    subfolder: pingSubfolder
  }).catch(ignoreErrors)
  setInterval(ping, connectionPing)
  ping()
  const controller = {
    ping: -Infinity,
    send: throttleBuffer(
      binaryData => {
        if (Date.now() - controller.ping <= connectionKeepAlive) {
          iotClient.sendCommandToDevice({
            name: remotePath,
            binaryData,
            subfolder: commandsSubfolder
          }).catch(ignoreErrors)
        }
      },
      bufferAccumulatorSize,
      bufferAccumulatorTTL,
      stub
    ),
    recv: null
  }
  client.on('message', (topic, message) => {
    if (topic.endsWith(commandsSubfolder))
      controller.recv?.(message, topic, message)
    else if (topic.endsWith(pingSubfolder))
      controller.ping = Date.now()
  })
  return controller
}

async function runDevice() {
  await ensurePair()
  const controller = await createController(deviceId, proxyId)
  require('./device')(controller)
}

async function runDevice_udp() {
  await ensurePair()
  const controller = await createController(deviceId, proxyId)
  require('./device-udp')(controller)
}

async function runProxy() {
  await ensurePair()
  const controller = await createController(proxyId, deviceId)
  require('./proxy')(controller)
}

async function main() {
  if (process.argv[2] === 'proxy')
    await runProxy()
  else if (process.argv[2] === 'device-udp')
    await runDevice_udp()
  else if (process.argv[2] === 'device')
    await runDevice()
  else
    throw new Error('Unknown service name: ' + process.argv[2])
}

if (require.main === module)
  main().catch(console.error)
