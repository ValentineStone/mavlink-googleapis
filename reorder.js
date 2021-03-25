const spawn = (timeout = 2000, breakpoint = 2 ** 16 - 1, width = 1000) => {
  let out_packetno = 0
  const packetnobuff = Buffer.alloc(2)
  const send = (buff) => {
    packetnobuff.writeUInt16BE(out_packetno)
    out_packetno = (out_packetno + 1) % breakpoint
    return Buffer.concat([packetnobuff, buff])
  }

  let in_packets = new Array(breakpoint)
  let in_packets_buffered = 0
  let in_packetno_awaited = null
  const in_packetno_next = () =>
    in_packetno_awaited = (in_packetno_awaited + 1) % breakpoint
  let last_rollout = Date.now()

  const attempt_rollout = (callback, forced) => {
    let rolled_out = 0
    if (forced)
      while (!in_packets[in_packetno_awaited])
        in_packetno_next()
    while (in_packets[in_packetno_awaited]) {
      const buff = in_packets[in_packetno_awaited]
      in_packets[in_packetno_awaited] = null
      in_packets_buffered--
      callback?.(buff)
      in_packetno_next()
      rolled_out++
    }
    if (rolled_out)
      last_rollout = Date.now()
    else if (
      !forced
      && in_packets_buffered
      && Date.now() - last_rollout >= timeout
    ) attempt_rollout(callback, true)
  }

  const recv = (buff, callback) => {
    const packetno = buff.readUInt16BE()
    if (in_packets[packetno])
      in_packets_buffered--
    in_packets[packetno] = buff.slice(2)
    in_packets_buffered++
    if (in_packetno_awaited === null)
      in_packetno_awaited = packetno
    attempt_rollout(callback)
  }

  return { send, recv }
}

module.exports = spawn