const dgram = require('dgram')
const SerialPort = require('serialport')
const { TrafficTracker } = require('./utils')

const path = process.env.DEVICE_SERIAL_PATH
const baudRate = +process.env.DEVICE_SERIAL_BAUD

const udpHost = process.env.DEVICE_UDP_HOST
const udpPort = process.env.DEVICE_UDP_PORT

const tracker = new TrafficTracker('from serial', 'from udp', () => true)

let serialLocation = 'disconnected'
let udpLocation = 'disconnected'
let rinfoLocation = 'disconnected'
const printStatus = () => {
  if (serialLocation !== 'disconnected' && udpLocation !== 'disconnected')
    console.log(`serial@${serialLocation} <=> udp@${udpLocation} <=> device@${rinfoLocation}`)
}

const serialport = new SerialPort(
  path,
  { baudRate, lock: false },
  () => {
    serialLocation = `${path}:${baudRate}`
    printStatus()
  }
)

const udp_socket = dgram.createSocket('udp4')
let rinfo = null
udp_socket.on('listening', () => {
  udpLocation = `${udpHost}:${udpPort}`
  printStatus()
  udp_socket.once('message', (msg, _rinfo) => {
    rinfo = _rinfo
    rinfoLocation = `${rinfo.address}:${rinfo.port}`
    printStatus()
  })
})
udp_socket.bind(udpPort, udpHost)

serialport.on('data', buff => {
  tracker['from serial'] += buff.length
  if (rinfo)
    udp_socket.send(buff, rinfo.port, rinfo.address)
})

udp_socket.on('message', buff => {
  tracker['from udp'] += buff.length
  if (serialport.isOpen)
    serialport.write(buff)
})
