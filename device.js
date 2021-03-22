const SerialPort = require('serialport')
const chalk = require('chalk')
const { TrafficTracker } = require('./utils')

const path = process.env.DEVICE_SERIAL_PATH
const baudRate = +process.env.DEVICE_SERIAL_BAUD
const restartDelay = +process.env.DEVICE_SERVICE_RESTART_DELAY
const pongTimeout = +process.env.DEVICE_SERVICE_PONG_TIMEOUT

// Connect all together

const run = async (controller) => {

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
      controller.send(buff)
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

const wait = ms => new Promise(r => setTimeout(r, ms))

const rerun = (controller) => {
  controller.tracker = new TrafficTracker('from device serial', 'from cloud', controller.online)
  run(controller).then(error => {
    console.log(error.message)
    console.log(chalk.blueBright('Waiting restart timeout...'))
    wait(restartDelay)
      .then(() => console.log(chalk.blueBright('Restarting...')))
      .then(() => rerun(controller))
  })
}

module.exports = controller => rerun(controller)
