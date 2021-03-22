const dgram = require('dgram')

const { TrafficTracker } = require('./utils')

const udpGCSHost = process.env.PROXY_UDP_GCS_HOST
const udpGSCPort = process.env.PROXY_UDP_GCS_PORT

const udp_socket = dgram.createSocket('udp4')
udp_socket.on('listening', () => {
  const address = udp_socket.address()
  console.log(`cloud <=> proxy@${address.address}:${address.port} <=> gcs@${udpGCSHost}:${udpGSCPort}`)
})
udp_socket.bind({})

module.exports = controller => {
  controller.tracker = new TrafficTracker('from udp proxy', 'from cloud', controller.online)
  controller.recv = buff => {
    controller.tracker['from cloud'] += buff.length
    udp_socket.send(buff, udpGSCPort, udpGCSHost)
  }

  udp_socket.on('message', buff => {
    controller.tracker['from udp proxy'] += buff.length
    controller.send(buff)
  })

}