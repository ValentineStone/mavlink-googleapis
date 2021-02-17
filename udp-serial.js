require('dotenv/config')
const dgram = require('dgram')
const SerialPort = require('serialport')

const path = process.env.DEVICE_SERIAL_PATH
const baudRate = +process.env.DEVICE_SERIAL_BAUD

const udpHost = process.env.DEVICE_UDP_HOST
const udpPort = process.env.DEVICE_UDP_PORT

let serialLocation = 'disconnected'
let udpLocation = 'disconnected'
let rinfoLocation = 'disconnected'
const printStatus = () => {
  if (serialLocation !== 'disconnected' && udpLocation !== 'disconnected')
    console.log(`serial@${serialLocation} <=> udp@${udpLocation} <=> device@${rinfoLocation}`)
}

const serialport = new SerialPort(
  path,
  { baudRate },
  () => {
    serialLocation = `${path}:${baudRate}`
    printStatus()
  }
)

const udp_socket = dgram.createSocket('udp4')
let rinfo = null
udp_socket.on('listening', () => {
  udpLocation = `${path}:${baudRate}`
  printStatus()
  udp_socket.once('message', (msg, _rinfo) => {
    rinfo = _rinfo
    rinfoLocation = `${rinfo.address}:${rinfo.port}`
    printStatus()
  })
})
udp_socket.bind(udpPort, udpHost)

serialport.on('data', buff => {
  if (!rinfo) {
    console.log('serial => udp', buff.length, 'skip')
  }
  else {
    console.log('serial => udp', buff.length)
    udp_socket.send(buff, rinfo.port, rinfo.address)
  }
})

udp_socket.on('message', buff => {
  if (serialport.isOpen) {
    console.log('udp => serial', buff.length)
    serialport.write(buff)
  }
  else {
    console.log('udp => serial', buff.length, 'skip')
  }
})




/*
let pongOnTimeout = false
const pong = () => {
  if (pongOnTimeout) return
  if (pongTimeout) {
    setTimeout(() => pongOnTimeout = false, pongTimeout)
    pongOnTimeout = true
  }
  console.log('pong')
  serialport.write(
    Uint8Array.from(
      processor.send(
        new mavlink20.messages.command_long(
          this.systemId, 1, 0,
          mavlink20.MAV_CMD_REQUEST_MESSAGE,
          mavlink20.MAVLINK_MSG_ID_PROTOCOL_VERSION
        )
      )
    )
  )
}
*/