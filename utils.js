const chalk = require('chalk')
const pad = str => chalk.yellow(String(str).padStart(10, ' '))
class TrafficTracker {
  constructor(name1, name2, interval = 1000) {
    this.name1 = name1
    this.name2 = name2
    this[name1] = 0
    this[name2] = 0
    setInterval(this.print, interval)
  }
  print = () => {
    if (!this.#silent) {
      console.log('recieved',
        pad(this[this.name1]), this.name1,
        pad(this[this.name2]), this.name2,
      )
    }
    this[this.name1] = 0
    this[this.name2] = 0
  }
  #silent = false
  silent = (silent = true) => this.#silent = silent
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const random_char = () => alphabet[Math.floor(Math.random() * alphabet.length)]
const uuid = require('uuid')
const pair_uuid = () => random_char() + '-' + uuid.v1()


const fs = require('fs')
const persist = (path, generate) => {
  let value
  try { value = fs.readFileSync(path, 'utf-8') }
  catch (e) { if (e.code !== 'ENOENT') throw e }
  if (!value) fs.writeFileSync(path, value = generate(), 'utf-8')
  return value
}

function throttleBuffer(send, bufferAccumulatorSize, bufferAccumulatorTTL, stub) {
  let accumulator = Buffer.from([])
  let accumulatorTime = 0
  return buff => {
    accumulator = Buffer.concat([accumulator, buff])
    if (
      accumulator.length >= bufferAccumulatorSize
      || Date.now() - accumulatorTime >= bufferAccumulatorTTL
    ) {
      const buff = accumulator
      accumulator = Buffer.from([])
      accumulatorTime = Date.now()
      if (!stub) return send(buff)
    }
  }
}

module.exports = {
  pad,
  TrafficTracker,
  persist,
  throttleBuffer,
  pair_uuid,
}