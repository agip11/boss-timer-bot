const makeWASocket = require('@whiskeysockets/baileys').default
const { useMultiFileAuthState } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const fs = require('fs')

// ID grup target (ubah sesuai grup kamu)
const targetGroup = "628xxxxxxxxxx-123456@g.us"

// Load data boss
function loadBosses() {
  if (!fs.existsSync('boss.json')) return []
  return JSON.parse(fs.readFileSync('boss.json'))
}

function saveBosses(bosses) {
  fs.writeFileSync('boss.json', JSON.stringify(bosses, null, 2))
}

let bosses = loadBosses()

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${h}h ${m}m ${s}s`
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('session')
  const sock = makeWASocket({ auth: state, printQRInTerminal: false })

  sock.ev.on('connection.update', ({ connection, qr }) => {
    if (qr) qrcode.generate(qr, { small: true })
    if (connection === 'open') console.log('✅ Bot WhatsApp aktif')
  })

  sock.ev.on('creds.update', saveCreds)

  // Handle pesan masuk
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    if (!m.message || !m.key.remoteJid) return
    const from = m.key.remoteJid
    const isGroup = from.endsWith('@g.us')
    const text = m.message.conversation?.trim() || m.message.extendedTextMessage?.text?.trim()
    if (!text) return

    const args = text.split(' ')
    const cmd = args[0].toLowerCase()

    // Hanya izinkan admin grup atau nomor tertentu
    const allowed = !isGroup || from === targetGroup
    if (!allowed) return

    if (cmd === '!addboss') {
      const name = args[1]
      const hours = parseInt(args[2])
      if (!name || isNaN(hours)) {
        return sock.sendMessage(from, { text: '❌ Format: !addboss NamaBoss IntervalJam' })
      }
      bosses.push({ name, spawnInterval: hours * 60 * 60 * 1000, nextSpawn: Date.now() + hours * 60 * 60 * 1000 })
      saveBosses(bosses)
      sock.sendMessage(from, { text: `✅ Boss ${name} ditambahkan (${hours} jam)` })
    }

    else if (cmd === '!delboss') {
      const name = args[1]
      bosses = bosses.filter(b => b.name.toLowerCase() !== name.toLowerCase())
      saveBosses(bosses)
      sock.sendMessage(from, { text: `🗑 Boss ${name} dihapus` })
    }

    else if (cmd === '!listboss') {
      if (bosses.length === 0) return sock.sendMessage(from, { text: '📭 Belum ada boss terdaftar' })
      let msg = '📜 Daftar Boss:\n'
      bosses.forEach(b => {
        msg += `- ${b.name} | Spawn dalam ${formatTime(b.nextSpawn - Date.now())}\n`
      })
      sock.sendMessage(from, { text: msg })
    }

    else if (cmd === '!setspawn') {
      const name = args[1]
      const minutes = parseInt(args[2])
      const boss = bosses.find(b => b.name.toLowerCase() === name.toLowerCase())
      if (!boss) return sock.sendMessage(from, { text: `❌ Boss ${name} tidak ditemukan` })
      boss.nextSpawn = Date.now() + minutes * 60 * 1000
      saveBosses(bosses)
      sock.sendMessage(from, { text: `✅ Spawn ${name} diatur ${minutes} menit dari sekarang` })
    }
  })

  // Cek spawn tiap menit
  setInterval(() => {
    const now = Date.now()
    bosses.forEach(boss => {
      if (now >= boss.nextSpawn) {
        sock.sendMessage(targetGroup, { text: `⚡ *${boss.name}* sudah spawn!` })
        boss.nextSpawn = now + boss.spawnInterval
        saveBosses(bosses)
      } else if (boss.nextSpawn - now <= 5 * 60 * 1000 && boss.nextSpawn - now > 0) {
        sock.sendMessage(targetGroup, { text: `⏳ *${boss.name}* spawn dalam ${formatTime(boss.nextSpawn - now)}` })
      }
    })
  }, 60 * 1000)
}

startBot()
