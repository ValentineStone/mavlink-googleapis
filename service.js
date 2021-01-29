require('dotenv/config')
const iot = require('@google-cloud/iot')
const { PubSub } = require('@google-cloud/pubsub')
const { readFileSync } = require('fs')
const jwt = require('jsonwebtoken')
const mqtt = require('mqtt')

// Pull from environment
const projectId = process.env.PROJECT_ID
const cloudRegion = process.env.CLOUD_REGION
const registryId = process.env.REGISTRY_ID
const deviceId = process.env.DEVICE_ID
const masterId = process.env.DEVICE_ID + '-master'
const publicKeyFile = process.env.PUBLIC_KEY_FILE
const privateKeyFile = process.env.PRIVATE_KEY_FILE
const bufferAccumulatorSize = +process.env.BUFFER_ACCUMULATOR_SIZE

const algorithm = `ES256`
const mqttBridgeHostname = `mqtt.googleapis.com`
const mqttBridgePort = 8883

const iotClient = new iot.v1.DeviceManagerClient()

const catchAlreadyExists = e => {
  if (e.code === 6); // A resource with that parent and ID already exists
  else throw e
}

async function ensureDeviceRegistry() {
  await iotClient.createDeviceRegistry({
    parent: iotClient.locationPath(projectId, cloudRegion),
    deviceRegistry: { id: registryId },
  }).catch(catchAlreadyExists)
}

async function ensureDevice() {
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

async function ensureMaster() {
  await iotClient.createDevice({
    parent: iotClient.registryPath(projectId, cloudRegion, registryId),
    device: {
      id: masterId,
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

async function mqttConnect(asDeviceId) {
  const mqttClientId = iotClient.devicePath(
    projectId, cloudRegion, registryId, asDeviceId)

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

async function createController(localId, remoteId) {
  let accumulator = Buffer.from([])
  const client = await mqttConnect(localId)
  client.subscribe(`/devices/${localId}/commands/#`, { qos: 0 })
  const remotePath = iotClient.devicePath(
    projectId,
    cloudRegion,
    registryId,
    remoteId
  )
  const controller = {
    send: async message => {
      accumulator = Buffer.concat([accumulator, message])
      if (accumulator.length >= bufferAccumulatorSize) {
        const binaryData = accumulator
        accumulator = Buffer.from([])
        return await iotClient.sendCommandToDevice({
          name: remotePath,
          binaryData,
        }).catch(e => { })
      }
    },
    recv: null
  }
  client.on('message', (topic, message) => {
    if (controller.recv)
      controller.recv(message, topic, message)
  })
  return controller
}

async function asChat(controller) {
  controller.recv = message => console.log(message.toString())
  for await (const message of require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  })) {
    controller.send(Buffer.from(message))
  }
}

async function runDevice() {
  await ensureDeviceRegistry()
  await ensureDevice()
  await ensureMaster()
  const controller = await createController(deviceId, masterId)
  require('./device')(controller)
}

async function runMaster() {
  await ensureDeviceRegistry()
  await ensureDevice()
  await ensureMaster()
  const controller = await createController(masterId, deviceId)
  require('./master')(controller)
}

if (process.argv[2] === 'master')
  runMaster().catch(console.error)
else if (process.argv[2] === 'device')
  runDevice().catch(console.error)
else
  throw new Error('Unknown service name: ' + process.argv[2])
