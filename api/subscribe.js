// ============================================================
//  /api/subscribe.js — Vercel Serverless Function
//  Recibe el form de la landing y lo sube a ActiveCampaign
//  Lista: "Masterclass ACTIVA 30 abril" (ID 19)
//  Tag: masterclass-activa-30abr
//
//  Variables de entorno requeridas (Vercel → Settings → Environment Variables):
//    AC_API_URL     = https://fisioreferentes.api-us1.com
//    AC_API_KEY     = <tu API key>
//    AC_LIST_ID     = 19
//    AC_TAG         = masterclass-activa-30abr
// ============================================================

export default async function handler(req, res) {
  // CORS básico (ajusta origin si sirves la landing fuera del mismo dominio)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { nombre, email, telefono, facturacion } = req.body || {};

  // Validación mínima
  if (!nombre || !email || !telefono) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const AC_URL = process.env.AC_API_URL;
  const AC_KEY = process.env.AC_API_KEY;
  const AC_LIST = process.env.AC_LIST_ID || '19';
  const AC_TAG = process.env.AC_TAG || 'masterclass-activa-30abr';

  if (!AC_URL || !AC_KEY) {
    console.error('Faltan variables de entorno AC_API_URL o AC_API_KEY');
    return res.status(500).json({ error: 'Servidor mal configurado' });
  }

  const headers = {
    'Api-Token': AC_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  // Separa nombre/apellidos (best effort)
  const [firstName, ...restName] = String(nombre).trim().split(/\s+/);
  const lastName = restName.join(' ');

  try {
    // 1) Crear o actualizar contacto
    const contactPayload = {
      contact: {
        email: String(email).trim().toLowerCase(),
        firstName: firstName || '',
        lastName: lastName || '',
        phone: String(telefono).trim(),
        fieldValues: []
      }
    };

    const contactRes = await fetch(`${AC_URL}/api/3/contact/sync`, {
      method: 'POST',
      headers,
      body: JSON.stringify(contactPayload)
    });

    if (!contactRes.ok) {
      const errText = await contactRes.text();
      console.error('AC contact/sync error', contactRes.status, errText);
      return res.status(502).json({ error: 'No se pudo crear el contacto' });
    }

    const contactData = await contactRes.json();
    const contactId = contactData?.contact?.id;
    if (!contactId) {
      console.error('AC contact/sync sin id', contactData);
      return res.status(502).json({ error: 'Respuesta AC inesperada' });
    }

    // 2) Añadir a la lista
    await fetch(`${AC_URL}/api/3/contactLists`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contactList: {
          list: Number(AC_LIST),
          contact: Number(contactId),
          status: 1
        }
      })
    });

    // 3) Buscar o crear el tag
    let tagId = null;
    const tagSearchRes = await fetch(
      `${AC_URL}/api/3/tags?search=${encodeURIComponent(AC_TAG)}`,
      { headers }
    );
    if (tagSearchRes.ok) {
      const tagSearchData = await tagSearchRes.json();
      const found = (tagSearchData.tags || []).find(t => t.tag === AC_TAG);
      if (found) tagId = found.id;
    }
    if (!tagId) {
      const tagCreateRes = await fetch(`${AC_URL}/api/3/tags`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tag: { tag: AC_TAG, tagType: 'contact', description: 'Inscritos masterclass ACTIVA 30 abril' }
        })
      });
      if (tagCreateRes.ok) {
        const tagCreateData = await tagCreateRes.json();
        tagId = tagCreateData?.tag?.id;
      }
    }

    // 4) Asignar tag al contacto
    if (tagId) {
      await fetch(`${AC_URL}/api/3/contactTags`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contactTag: { contact: Number(contactId), tag: Number(tagId) }
        })
      });
    }

    // 5) Guardar facturación como nota en el contacto (campo no-estándar)
    if (facturacion) {
      await fetch(`${AC_URL}/api/3/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          note: {
            note: `Facturación declarada: ${facturacion}`,
            relid: Number(contactId),
            reltype: 'Subscriber'
          }
        })
      });
    }

    return res.status(200).json({ ok: true, contactId });
  } catch (err) {
    console.error('Error inesperado', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}
