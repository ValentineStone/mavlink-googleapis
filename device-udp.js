const dgram = require('dgram')
const { MAVLink20Processor, mavlink20 } = require('./MAVLink20')
const { TrafficTracker } = require('./utils')

const udpDeviceHost = process.env.DEVICE_UDP_HOST
const udpDevicePort = process.env.DEVICE_UDP_PORT
const mav2 = new MAVLink20Processor()

const udp_socket = dgram.createSocket('udp4')
let rinfo = null
udp_socket.on('listening', () => {
  console.log(`cloud <=> proxy@${udpDeviceHost}:${udpDevicePort} <=> device@disconnected`)
  udp_socket.once('message', (msg, _rinfo) => {
    rinfo = _rinfo
    console.log(`cloud <=> proxy@${udpDeviceHost}:${udpDevicePort} <=> device@${rinfo.address}:${rinfo.port}`)
  })
})
udp_socket.bind(udpDevicePort, udpDeviceHost)

module.exports = controller => {
  controller.tracker = new TrafficTracker('from device udp', 'from cloud', controller.online)
  controller.recv = buff => {
    controller.tracker['from cloud'] += buff.length
    if (rinfo) udp_socket.send(buff, rinfo.port, rinfo.address)
  }
  udp_socket.on('message', buff => {
    controller.tracker['from device udp'] += buff.length
    for (const message of mav2.parseBuffer(buff)) {
      if (message instanceof mavlink20.messages.bad_data) /* bad message */;
      else controller.send(message.msgbuf)
    }
  })
}