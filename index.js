import 'dotenv/config'
import express from 'express'
import path from "node:path";
import db, { inicializarDB } from './config/database.js'
import { fileURLToPath } from 'node:url';

const app = express()
const port = 3000

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json())

inicializarDB()

const sesiones = {};
app.post('/messages/test', (req, res) => { 

  const { from, text } = req.body; 

  if (!from) return res.status(400).json({ error: 'falta from' }); 
  if(!text) return res.status(400).json({ error: 'falta text' }); 
  
  const s = sesiones[from] ??= { paso: 1, datos: {} };
  const mensajeLimpio = text.toLowerCase().trim();

  let bot = '';
  switch (s.paso) {
    case 1:
      if (mensajeLimpio === "hola") {
        s.paso = 2;
        bot = "Hola, ¿Cómo te llamas?";
        return res.json({ bot });
      } else {
        return res.json({ bot: "No te entendí. Por favor, escribe 'Hola' para comenzar." });
      }
      break;
    case 2: 
      s.paso = 3;
      s.datos.usuario = text; 
      bot = `Bienvenido ${text}, ¿qué producto deseas ordenar el día de hoy?`;
      return res.json({
        bot,
        producto: "zapato",
        img: `http://localhost:3000/test.png`
      });
      break;
    case 3:
      if (mensajeLimpio === 'zapato') {
        s.datos.estado = "pendiente";
        s.datos.producto = text;
        bot = `Tu pedido de ${text} está en estado pendiente.`;

        return res.json({ bot, image: `http://localhost:3000/test.png` });
      } else {
        return res.json({ bot: "Lo siento, actualmente solo tenemos disponible: 'zapato'." });
      }
      default:
      return res.json({ bot: "Algo salió mal con tu sesión, la hemos reiniciado. Por favor escribe 'Hola'." });
  }
}); 

app.post('/messages', async (req, res) => { 
  const { from, text } = req.body; 

  if (!from) return res.status(400).json({ error: 'falta from' }); 
  if (!text) return res.status(400).json({ error: 'falta text' });

  const esTelefonoValido = !isNaN(from.trim()) && from.trim() !== '';
  const mensajeLimpio = text.toLowerCase().trim();

  if (!esTelefonoValido) {
    return res.status(400).json({ error: 'El teléfono debe contener solo números' });
  }

  try {
    const respuesta = await db.tx(async (t) => {
      let contacto = await t.oneOrNone('SELECT * FROM contactos WHERE telefono = $1', [from]);
      let pasoActual = 1;

      if (!contacto) {
        contacto = await t.one('INSERT INTO contactos(telefono) VALUES($1) RETURNING *', [from]);
      } else {
        const ultimoMensaje = await t.oneOrNone(
          'SELECT paso FROM mensajes WHERE contacto_id = $1 ORDER BY creado_en DESC LIMIT 1',
          [contacto.id]
        );

        if (ultimoMensaje) {
          pasoActual = ultimoMensaje.paso;
        }
      }

      let bot = {
        reply: "",
        producto: null,
        productos: [{
          nombre: "zapato",
          img: "http://localhost:3000/test.png"
        }]
      };

      let siguientePaso = pasoActual;
      let respuesta;

      switch (pasoActual) {
        case 1:
          if (mensajeLimpio === "hola") {
            siguientePaso = 2;
            bot.reply = "Hola, ¿Cómo te llamas?";

            await t.none(
              'INSERT INTO mensajes (contacto_id, direccion, texto, paso) VALUES ($1, $2, $3, $4)',
              [contacto.id, 'in', mensajeLimpio, siguientePaso]
            );
          respuesta = {
           reply: bot.reply
          };  
          } else {
            bot.reply = "No te entendí. Por favor, escribe 'Hola' para comenzar.";
               respuesta = {
                reply: bot.reply
            };
          }
          break;

        case 2:
          bot.reply = `Bienvenido ${text}, ¿qué producto deseas ordenar el día de hoy?`;
          console.log(text)
          await t.none(
            'UPDATE contactos SET nombre = $1 WHERE id = $2',
            [text, contacto.id]
          );
        
          siguientePaso = 3;
          await t.none(
            'INSERT INTO mensajes (contacto_id, direccion, texto, paso) VALUES ($1, $2, $3, $4)',
            [contacto.id, 'in', text, siguientePaso,]
          );
          siguientePaso = 3;
          respuesta = {
            reply: bot.reply,
            productos: bot.productos
          };
        break;

        case 3:
          const productoSeleccionado = bot.productos.find(
            producto => mensajeLimpio === producto.nombre
          );

          if (productoSeleccionado) {
            const totalSolicitudes = await t.one('SELECT count(*) FROM solicitudes');
            const numeroFormateado = String(totalSolicitudes.count).padStart(3, '0');
            const evento_id = `ev-${numeroFormateado}`;

            await t.none(
              'INSERT INTO mensajes (contacto_id, direccion, texto, paso, imagen_url) VALUES ($1, $2, $3, $4, $5)',
              [contacto.id, 'in', productoSeleccionado.nombre, siguientePaso, productoSeleccionado.img]
            );

            await t.none(
              'INSERT INTO solicitudes (producto, estado, evento_id, contacto_id) VALUES($1, $2, $3, $4)',
              [productoSeleccionado.nombre, "pendiente", evento_id, contacto.id]
            );

            bot.reply = `Tu pedido de ${text} está en estado pendiente.`;
            bot.producto = productoSeleccionado.img;
          } else {
            bot.reply = "Lo siento, actualmente solo tenemos disponible: 'zapato'.";
          }
          break;

        default:
          bot.reply = "Algo salió mal. Reiniciando...";
          break;
      }

      if (bot.reply) {
        await t.none(
          'INSERT INTO mensajes (contacto_id, direccion, texto, paso) VALUES ($1, $2, $3, $4)',
          [contacto.id, 'out', bot.reply, siguientePaso]
        );
      }

      delete bot.productos;

      return {
        status: 200,
        json: respuesta ?? {
          reply: bot.reply,
          producto: bot.producto
        }
      };
    });

    return res.status(respuesta.status).json(respuesta.json);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/webhook/confirmacion', async (req, res) => {
  const secretHeader = req.headers['x-webhook-secret'];
  if (!secretHeader || secretHeader !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'no autorizado' });
  }

  const { evento_id, solicitud_id } = req.body;

  if (!evento_id || !solicitud_id) {
    return res.status(400).json({ error: 'Faltan campos obligatorios: evento_id y solicitud_id' });
  }

  try {
    const respuesta = await db.tx(async (t) => {
      
      const eventoExistente = await t.oneOrNone('SELECT id FROM solicitudes WHERE evento_id = $1', [evento_id]);
      if (eventoExistente) {
        return { status: 200, json: { mensaje: 'Evento duplicado, ya procesado anteriormente' } };
      }

      // actualizar la solicitud pendiente
      const resultado = await t.result(`
        UPDATE solicitudes 
        SET estado = 'confirmada', evento_id = $1 
        WHERE id = $2 AND estado = 'pendiente'
      `, [evento_id, solicitud_id]);

      // verificamos porque no afecto la fila
      if (resultado.rowCount === 0) {
        const solicitudExiste = await t.oneOrNone('SELECT id, estado FROM solicitudes WHERE id = $1', [solicitud_id]);
        
        if (!solicitudExiste) {
          return { status: 404, json: { error: 'Solicitud no encontrada' } };
        }
        
        return { status: 200, json: { mensaje: 'La solicitud ya estaba confirmada o no disponible' } };
      }

      return { status: 200, json: { mensaje: 'Solicitud confirmada exitosamente' } };
    });

    return res.status(respuesta.status).json(respuesta.json);

  } catch (error) {
    console.error('Error procesando confirmación de webhook:', error);
    return res.status(500).json({ error: 'Error interno de la base de datos' });
  }
});

app.get('/solicitudes', async (req, res) => {
  try {
    const solicitudes = await db.any(`
      SELECT
        s.id,
        c.telefono,
        c.contacto,
        s.producto,
        s.estado,
        s.evento_id
      FROM solicitudes s
      JOIN contactos c
      ON c.id = s.contacto_id
      ORDER BY s.id DESC
    `);

    return res.status(200).json(solicitudes);

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: 'Error al obtener las solicitudes'
    });
  }
});


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})