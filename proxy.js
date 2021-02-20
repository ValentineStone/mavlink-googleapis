const dgram = require('dgram')
const { MAVLink20Processor, mavlink20 } = require('./MAVLink20')

const { TrafficTracker } = require('./utils')
const tracker = new TrafficTracker('from udp proxy', 'from cloud')

const udpGCSHost = process.env.PROXY_UDP_GCS_HOST
const udpGSCPort = process.env.PROXY_UDP_GCS_PORT

const mav2 = new MAVLink20Processor()

const udp_socket = dgram.createSocket('udp4')
udp_socket.on('listening', () => {
  const address = udp_socket.address()
  console.log(`cloud <=> proxy@${address.address}:${address.port} <=> gcs@${udpGCSHost}:${udpGSCPort}`)
})
udp_socket.bind({})

module.exports = controller => {
  controller.recv = buff => {
    tracker['from cloud'] += buff.length
    udp_socket.send(buff, udpGSCPort, udpGCSHost)
  }

  udp_socket.on('message', buff => {
    tracker['from udp proxy'] += buff.length
    for (const message of mav2.parseBuffer(buff)) {
      if (message instanceof mavlink20.messages.bad_data);
      else
        controller.send(message.msgbuf)
    }
  })

}