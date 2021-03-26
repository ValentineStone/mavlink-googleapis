const { MAVLink20Processor, mavlink20 } = require('./MAVLink20')
const mavlinkId = +process.env.MAVLINK_SYSTEM_ID || 1
const pongTimeout = +process.env.DEVICE_SERVICE_PONG_TIMEOUT

const spawn = () => {
  const mav2 = new MAVLink20Processor()

  let pongOnTimeout = false
  const pong = (send) => {
    if (pongOnTimeout) return
    if (pongTimeout) {
      setTimeout(() => pongOnTimeout = false, pongTimeout)
      pongOnTimeout = true
    }
    console.log('pong')
    send(
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

  const send = (buff, sendBack) => {
    const messages = []
    for (const message of mav2.parseBuffer(buff)) {
      if (message instanceof mavlink20.messages.bad_data)
        pong(sendBack)
      else
        messages.push(message.msgbuf)
    }
    return Buffer.concat(messages)
  }

  const recv = (buff, callback) => callback(buff)
  const reset = () => { }
  return { send, recv, reset }
}

module.exports = spawn