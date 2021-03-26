const spawn = (breakpoint = 2 ** 16 - 1, buffered_width = 100, skip_count = 5) => {
  let out_packetno = 0
  const packetnobuff = Buffer.alloc(2)
  const packetno_curr = packetno => packetno % breakpoint
  const packetno_next = packetno => packetno_curr(packetno + 1)
  const send = (buff) => {
    packetnobuff.writeUInt16BE(out_packetno)
    out_packetno = packetno_next(out_packetno)
    return Buffer.concat([packetnobuff, buff])
  }

  let in_packets = new Array(buffered_width)
  let in_packets_buffered = 0
  let in_packetno_awaited = null
  const in_packet = (packetno, in_packet) => {
    if (in_packetno_awaited === null)
      in_packetno_awaited = packetno
    const localno = packetno % buffered_width
    if (in_packet !== undefined) {
      if (in_packet !== null) {
        if (in_packets[localno]) {
          for (let i = 0; i < in_packets.length; i++)
            in_packets[localno] = null
          in_packets_buffered = 0
          in_packetno_awaited = packetno
        }
        in_packets[localno] = in_packet
        in_packets_buffered++
      } else {
        if (in_packets[localno]) {
          in_packets[localno] = null
          in_packets_buffered--
        }
      }
    }
    return in_packets[localno]
  }
  const consecutive_seq = (start_packetno, max) => {
    let curr_packetno = start_packetno
    let seq_curr_packetno = start_packetno
    let seq_max_packetno = start_packetno
    let seq_max = 0
    let seq_max_pos = 0
    let seq_curr = 0
    let seq_present = false
    for (let i = 0; i < in_packets.length; i++, curr_packetno++) {
      const pos = (i + start_packetno) % in_packets.length
      if (in_packets[pos]) {
        if (seq_present) {
          seq_curr++
        } else {
          seq_curr_packetno = curr_packetno
          seq_present = true
          seq_curr = 1
        }
      } else {
        if (seq_present) {
          if (seq_curr > seq_max) {
            seq_max = seq_curr
            seq_max_pos = pos
            seq_max_packetno = seq_curr_packetno
            if (seq_max >= max)
              break
          }
          seq_present = false
          seq_curr = 0
        }
      }
    }
    return [seq_max, seq_max_packetno, seq_max_pos]
  }

  const attempt_rollout = callback => {
    let rolled_out = 0
    let in_packet_awaited
    console.log('ROLL', in_packetno_awaited)
    while (in_packet_awaited = in_packet(in_packetno_awaited)) {
      console.log('ROLL', in_packetno_awaited, '=', !!in_packet_awaited)
      in_packet(in_packetno_awaited, null)
      callback?.(in_packet_awaited)
      in_packetno_awaited = packetno_next(in_packetno_awaited)
      rolled_out++
    }
    return rolled_out
  }

  const recv = (buff, callback) => {
    const packetno = buff.readUInt16BE()
    console.log('RECV', packetno)
    in_packet(packetno, buff.slice(2))
    const rolled_out = attempt_rollout(callback)
    if (!rolled_out) {
      const [count, packetno] = consecutive_seq(in_packetno_awaited, skip_count)
      console.log('OOO ', [count, packetno])
      if (count >= skip_count) {
        console.log('PACKET LOSS, SKIPPING')
        in_packetno_awaited = packetno
        attempt_rollout(callback)
      }
    }
  }

  const reset = () => {
    console.log('FORCE RESET')
    out_packetno = 0
    in_packets = new Array(buffered_width)
    in_packets_buffered = 0
    in_packetno_awaited = null
  }

  return { send, recv, reset }
}

module.exports = spawn