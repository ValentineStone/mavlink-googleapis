const dgram = require('dgram')
const { debounce } = require('lodash')
const { MAVLink20Processor, mavlink20 } = require('./MAVLink20')

const mavlinkId = process.env.MAVLINK_ID
const udpDeviceHost = process.env.DEVICE_UDP_HOST
const udpDevicePort = process.env.DEVICE_UDP_PORT
let rinfo = null

const mav2 = new MAVLink20Processor()

const udp_socket = dgram.createSocket('udp4')
udp_socket.on('listening', () => {
  console.log(`cloud <=> proxy@${udpDeviceHost}:${udpDevicePort} <=> device@disconnected`)
  udp_socket.once('message', (msg, _rinfo) => {
    rinfo = _rinfo
    console.log(`cloud <=> proxy@${udpDeviceHost}:${udpDevicePort} <=> device@${rinfo.address}:${rinfo.port}`)
  })
})
udp_socket.bind(udpDevicePort, udpDeviceHost)

module.exports = controller => {
  controller.recv = buff => {
    if (!rinfo) {
      console.log('skip', 'recv', buff.length)
    }
    else {
      console.log('recv', buff.length)
      udp_socket.send(buff, rinfo.port, rinfo.address)
    }
  }

  udp_socket.on('message', buff => {
    for (const message of mav2.parseBuffer(buff)) {
      if (message instanceof mavlink20.messages.bad_data) {
        console.log('skip', 'send', message.msgbuf.length, 'as', message.name)
      }
      else {
        console.log('send', message.msgbuf.length, 'as', message.name)
        controller.send(message.msgbuf)
      }
    }
  })

}