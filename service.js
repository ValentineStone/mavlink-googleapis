require('dotenv/config')
const iot = require('@google-cloud/iot')
const { PubSub } = require('@google-cloud/pubsub')
const { readFileSync } = require('fs')
const { createInterface } = require('readline')
const jwt = require('jsonwebtoken')
const mqtt = require('mqtt')

// Client retrieved in callback
const projectId = process.env.PROJECT_ID
const cloudRegion = process.env.CLOUD_REGION
const registryId = process.env.REGISTRY_ID
const deviceId = process.env.DEVICE_ID
const publicKeyFile = process.env.PUBLIC_KEY_FILE
const privateKeyFile = process.env.PRIVATE_KEY_FILE

const algorithm = `ES256`
const mqttBridgeHostname = `mqtt.googleapis.com`
const mqttBridgePort = 8883
const pubsubTopicName = `projects/${projectId}/topics/iot-locations-${cloudRegion}-registries-${registryId}-devices-${deviceId}`
const pubsubSubscriptionName = `projects/${projectId}/subscriptions/iot-locations-${cloudRegion}-registries-${registryId}-devices-${deviceId}`

const iotClient = new iot.v1.DeviceManagerClient()
const pubSubClient = new PubSub()
const readline = createInterface({
  input: process.stdin,
  output: process.stdout,
})

const catchAlreadyExists = e => {
  if (e.code === 6); // A resource with that parent and ID already exists
  else throw e
}

async function ensureTopic() {
  await pubSubClient.createTopic(pubsubTopicName).catch(catchAlreadyExists)
}

async function ensureSubscription() {
  await pubSubClient.topic(pubsubTopicName)
    .createSubscription(pubsubSubscriptionName, {
      messageRetentionDuration: 600, // seconds
      ackDeadlineSeconds: 600,       // seconds
    })
    .catch(catchAlreadyExists)
}

async function ensureDeviceRegistry() {
  await iotClient.createDeviceRegistry({
    parent: iotClient.locationPath(projectId, cloudRegion),
    deviceRegistry: {
      id: registryId,
      eventNotificationConfigs: [{ pubsubTopicName }]
    },
  }).catch(catchAlreadyExists)
}

async function ensureDevice() {
  await iotClient.createDevice({
    parent: iotClient.registryPath(projectId, cloudRegion, registryId),
    device: {
      id: deviceId,
      credentials: [
        {
          publicKey: {
            format: 'ES256_PEM',
            key: readFileSync(publicKeyFile).toString(),
          },
        },
      ],
    },
  }).catch(catchAlreadyExists)
}

const createJwt = (projectId, privateKeyFile, algorithm) => {
  // Create a JWT to authenticate this device. The device will be disconnected
  // after the token expires, and will have to reconnect with a new token. The
  // audience field should always be set to the GCP project id.
  const token = {
    iat: parseInt(Date.now() / 1000),
    exp: parseInt(Date.now() / 1000) + 60 * 60 * 24, // 1 day
    aud: projectId,
  }
  const privateKey = readFileSync(privateKeyFile)
  return jwt.sign(token, privateKey, { algorithm })
}

async function mqttConnect() {
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

async function runDevice() {
  await ensureTopic()
  await ensureDeviceRegistry()
  await ensureDevice()

  const client = await mqttConnect()

  // Subscribe to the /devices/{device-id}/commands/# topic to receive all
  // commands or to the /devices/{device-id}/commands/<subfolder> to just receive
  // messages published to a specific commands folder we recommend you use
  // QoS 0 (at most once delivery)
  client.subscribe(`/devices/${deviceId}/commands/#`, { qos: 0 })

  client.on('message', (topic, message) => {
    console.log(message.toString())
  })

  for await (const line of readline) {
    client.publish(`/devices/${deviceId}/events`, line, { qos: 0 })
  }
}

async function runServer() {
  await ensureTopic()
  await ensureDeviceRegistry()
  await ensureDevice()
  await ensureSubscription()

  const subscription = pubSubClient.subscription(pubsubSubscriptionName)
  await subscription.seek(new Date())
  subscription.on('message', message => {
    message.ack()
    console.log(message.data.toString())
  })

  for await (const line of readline) {
    iotClient.sendCommandToDevice({
      name: iotClient.devicePath(
        projectId,
        cloudRegion,
        registryId,
        deviceId
      ),
      binaryData: Buffer.from(line),
    }).catch(console.error)
  }
}

if (process.argv[2] === 'server')
  runServer().then(console.log).catch(console.error)
else if (process.argv[2] === 'device')
  runDevice().then(console.log).catch(console.error)
else
  throw new Error('Unknown service name: ' + process.argv[2])
