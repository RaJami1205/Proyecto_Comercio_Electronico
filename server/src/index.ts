/** Inicia el servidor HTTP usando la aplicación Express y la configuración server-side. */
import app from './app.js'
import { serverConfig } from './config/env.js'
import { database } from './db/pool.js'

const server = app.listen(serverConfig.port, () => {
  console.log(`API de CiberNova disponible en http://localhost:${serverConfig.port}.`)
})

let shuttingDown = false
/** Deja terminar las solicitudes HTTP y libera PostgreSQL si el proceso llegó a utilizarlo. */
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  server.close(() => {
    void database.close().catch(() => {
      console.error('No se pudo cerrar PostgreSQL de forma ordenada.')
      process.exitCode = 1
    })
  })
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
