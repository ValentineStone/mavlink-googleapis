const dgram = require('dgram')
const { debounce } = require('lodash')
const { MAVLink20Processor, mavlink20 } = require('./MAVLink20')

const udpGCSHost = process.env.MASTER_UDP_GCS_HOST
const udpGSCPort = process.env.MASTER_UDP_GCS_PORT

const mav2 = new MAVLink20Processor()

const udp_socket = dgram.createSocket('udp4')
udp_socket.on('listening', () => {
  const address = udp_socket.address()
  console.log(`cloud <=> proxy@${address.address}:${address.port} <=> gcs@${udpGCSHost}:${udpGSCPort}`)
})
udp_socket.bind({})

module.exports = controller => {
  controller.recv = buff => {
    console.log('recv', buff.length)
    udp_socket.send(buff, udpGSCPort, udpGCSHost)
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