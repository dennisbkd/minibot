import 'dotenv/config'
import express from 'express'
import { inicializarDB } from './config/database.js'

const app = express()
const port = 3000

inicializarDB()

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})