require('dotenv/config')

if (process.argv[2] === 'serial-udp')
  return require('./serial-udp')

const iot = require('@google-cloud/iot')
const { readFileSync } = require('fs')
const jwt = require('jsonwebtoken')
const mqtt = require('mqtt')
const googleCredentials = require(process.env.GOOGLE_APPLICATION_CREDENTIALS)

// Pull from environment
const projectId = googleCredentials.project_id
const cloudRegion = process.env.CLOUD_REGION
const deviceRegistryId = 'devices'
const proxyRegistryId = 'proxies'
const deviceId = 'd' + process.env.DEVICE_UUID
const publicKeyFile = process.env.PUBLIC_KEY_FILE
const privateKeyFile = process.env.PRIVATE_KEY_FILE
const bufferAccumulatorSize = +process.env.BUFFER_ACCUMULATOR_SIZE
const bufferAccumulatorTTL = +process.env.BUFFER_ACCUMULATOR_TTL
const commandsSubfolder = 'mavlink2'
const stub = !!process.env.STUB

const algorithm = `ES256`
const mqttBridgeHostname = `mqtt.googleapis.com`
const mqttBridgePort = 8883

const iotClient = new iot.v1.DeviceManagerClient()

const catchAlreadyExists = e => {
  if (e.code === 6); // A resource with that parent and ID already exists
  else throw e
}

async function ensureRegistry(registryId) {
  await iotClient.createDeviceRegistry({
    parent: iotClient.locationPath(projectId, cloudRegion),
    deviceRegistry: { id: registryId },
  }).catch(catchAlreadyExists)
}

async function ensureDevice(registryId, deviceId) {
  await iotClient.createDevice({
    parent: iotClient.registryPath(projectId, cloudRegion, registryId),
    device: {
      id: deviceId,
      credentials: [{
        publicKey: {
          format: 'ES256_PEM',
          key: readFileSync(publicKeyFile).toString(),
        },
      }],
    },
  }).catch(catchAlreadyExists)
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
    host: mqttBridgeHostname,
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

async function createController(
  localRegistry, localDevice,
  remoteRegistry, remoteDevice
) {
  let accumulator = Buffer.from([])
  let accumulatorTime = 0
  const client = await mqttConnect(localRegistry, localDevice)
  client.subscribe(`/devices/${localDevice}/commands/#`, { qos: 0 })
  const remotePath = iotClient.devicePath(
    projectId,
    cloudRegion,
    remoteRegistry,
    remoteDevice
  )
  const controller = {
    send: async message => {
      accumulator = Buffer.concat([accumulator, message])
      if (
        accumulator.length >= bufferAccumulatorSize
        || Date.now() - accumulatorTime >= bufferAccumulatorTTL
      ) {
        const binaryData = accumulator
        accumulator = Buffer.from([])
        accumulatorTime = Date.now()
        if (stub) return
        return await iotClient.sendCommandToDevice({
          name: remotePath,
          binaryData,
          subfolder: commandsSubfolder
        }).catch(e => { })
      }
    },
    recv: null
  }
  client.on('message', (topic, message) => {
    if (controller.recv && topic.endsWith(commandsSubfolder))
      controller.recv(message, topic, message)
  })
  return controller
}

async function runDevice() {
  await ensureRegistry(deviceRegistryId)
  await ensureRegistry(proxyRegistryId)
  await ensureDevice(deviceRegistryId, deviceId)
  await ensureDevice(proxyRegistryId, deviceId)
  const controller = await createController(
    deviceRegistryId, deviceId,
    proxyRegistryId, deviceId,
  )
  require('./device')(controller)
}

async function runDevice_udp() {
  await ensureRegistry(deviceRegistryId)
  await ensureRegistry(proxyRegistryId)
  await ensureDevice(deviceRegistryId, deviceId)
  await ensureDevice(proxyRegistryId, deviceId)
  const controller = await createController(
    deviceRegistryId, deviceId,
    proxyRegistryId, deviceId,
  )
  require('./device-udp')(controller)
}

async function runProxy() {
  await ensureRegistry(deviceRegistryId)
  await ensureRegistry(proxyRegistryId)
  await ensureDevice(deviceRegistryId, deviceId)
  await ensureDevice(proxyRegistryId, deviceId)
  const controller = await createController(
    proxyRegistryId, deviceId,
    deviceRegistryId, deviceId,
  )
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
