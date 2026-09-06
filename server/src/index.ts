import app from './app.js'
import { serverConfig } from './config/env.js'

app.listen(serverConfig.port, () => {
  console.log(`API de CiberNova disponible en http://localhost:${serverConfig.port}.`)
})
