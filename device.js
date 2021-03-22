const SerialPort = require('serialport')
const { MAVLink20Processor, mavlink20 } = require('./MAVLink20')
const chalk = require('chalk')
const { TrafficTracker } = require('./utils')

const mavlinkId = +process.env.MAVLINK_SYSTEM_ID || 1
const path = process.env.DEVICE_SERIAL_PATH
const baudRate = +process.env.DEVICE_SERIAL_BAUD
const restartDelay = +process.env.DEVICE_SERVICE_RESTART_DELAY
const pongTimeout = +process.env.DEVICE_SERVICE_PONG_TIMEOUT

const mav2 = new MAVLink20Processor()

// Connect all together

const run = async (controller) => {
  controller.tracker = new TrafficTracker('from device serial', 'from cloud', controller.online)

  let serialport

  try {
    console.log(chalk.blueBright('Startig...'))

    serialport = new SerialPort(path, {
      baudRate: baudRate,
      autoOpen: false,
      lock: false,
    })

    await new Promise((resolve, reject) => {
      serialport.on('error', reject)
      serialport.on('open', error => error ? reject(error) : resolve())
      serialport.open()
    })

    console.log(chalk.blueBright('Serialport open'))
    console.log(`cloud <=> serial@${path}:${baudRate} <=> device`)

    serialport.on('data', buff => {
      controller.tracker['from device serial'] += buff.length
      for (const message of mav2.parseBuffer(buff)) {
        if (message instanceof mavlink20.messages.bad_data)
          pong(serialport, message)
        else
          controller.send(message.msgbuf)
      }
    })

    controller.recv = buff => {
      controller.tracker['from cloud'] += buff.length
      if (serialport.isOpen)
        serialport.write(buff)
    }

    await new Promise((resolve, reject) => {
      serialport.on('error', reject)
      serialport.on('close', () => reject(new Error('Serialport closed')))
    })
  }
  catch (error) {
    console.log(chalk.blueBright('Stopping...'))
    if (serialport) {
      await new Promise(r => serialport.close(r))
      console.log(chalk.blueBright('Serialport closed'))
    }
    return error
  }
}

// Utils

let pongOnTimeout = false
const pong = serialport => {
  if (pongOnTimeout) return
  if (pongTimeout) {
    setTimeout(() => pongOnTimeout = false, pongTimeout)
    pongOnTimeout = true
  }
  console.log('pong')
  serialport.write(
    Uint8Array.from(
      mav2.send(
        new mavlink20.messages.command_long(
          mavlinkId, 1, 0,
          mav2.MAV_CMD_REQUEST_MESSAGE,
          mav2.MAVLINK_MSG_ID_PROTOCOL_VERSION
        )
      )
    )
  )
}

const wait = ms => new Promise(r => setTimeout(r, ms))

const rerun = (controller) => {
  run(controller).then(error => {
    console.log(error.message)
    console.log(chalk.blueBright('Waiting restart timeout...'))
    wait(restartDelay)
      .then(() => console.log(chalk.blueBright('Restarting...')))
      .then(() => rerun(controller))
  })
}

module.exports = controller => rerun(controller)
