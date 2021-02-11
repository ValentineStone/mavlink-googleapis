const SerialPort = require('serialport')
const { MAVLink20Processor, mavlink20 } = require('./MAVLink20')

const mavlinkId = +process.env.MAVLINK_ID
const path = process.env.DEVICE_SERIAL_PATH
const baudRate = +process.env.DEVICE_SERIAL_BAUD
const restartDelay = +process.env.DEVICE_SERVICE_RESTART_DELAY
const pongTimeout = +process.env.DEVICE_SERVICE_PONG_TIMEOUT

const mav2 = new MAVLink20Processor()

// Connect all together

const run = async (controller) => {

  let serialport

  try {
    console.log('Connecting...')

    serialport = new SerialPort(path, {
      baudRate: baudRate,
      autoOpen: false
    })

    await new Promise((resolve, reject) => {
      serialport.on('error', reject)
      serialport.on('open', error => {
        if (error) reject(error)
        console.log(`cloud <=> serial@${path}:${baudRate} <=> device`)
        resolve()
      })
      serialport.open()
    })

    console.log('Serialport connected')

    serialport.on('data', buff => {
      let msgCounter = 0
      for (const message of mav2.parseBuffer(buff)) {
        if (message instanceof mavlink20.messages.bad_data) {
          if (message.msgbuf.length === 1)
            msgCounter++
          else
            console.log('skip', 'send', message.msgbuf.length, 'as', 'bad_data')
          pong(serialport, message)
        }
        else {
          console.log('send', message.msgbuf.length, 'as', message.name)
          controller.send(message.msgbuf)
        }
      }
      if (msgCounter)
        if (msgCounter === buff.length)
          console.log('skip', 'send', buff)
        else
          console.log('skip', 'send', 1, 'x', msgCounter, 'as', 'bad_data')
    })

    controller.recv = buff => {
      if (serialport.isOpen) {
        console.log('recv', buff.length)
        serialport.write(buff)
      }
      else
        console.log('skip', 'recv', buff.length)
    }

    await new Promise((resolve, reject) => {
      serialport.on('error', reject)
      serialport.on('close', () => reject(new Error('Serialport closed')))
    })
  }
  catch (error) {
    console.log('Stopping...')
    if (serialport) {
      await new Promise(r => serialport.close(r))
      console.log('Stopped Serialport')
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
    console.log('Waiting restart timeout...')
    wait(restartDelay)
      .then(() => console.log('Restarting...'))
      .then(() => rerun(controller))
  })
}

module.exports = controller => rerun(controller)
