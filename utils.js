require('colors')
const pad = str => String(str).padStart(10, ' ').yellow
class TrafficTracker {
  constructor(name1, name2, interval = 1000) {
    this.name1 = name1
    this.name2 = name2
    this[name1] = 0
    this[name2] = 0
    setInterval(this.print, interval)
  }
  print = () => {
    console.log('recieved',
      pad(this[this.name1]), this.name1,
      pad(this[this.name2]), this.name2,
    )
    this[this.name1] = 0
    this[this.name2] = 0
  }
}

module.exports = { pad, TrafficTracker }