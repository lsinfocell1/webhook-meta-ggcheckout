const crypto = require('crypto');

const PIXEL_ID = '1787982735449338';
const ACCESS_TOKEN = 'EAAZAZCWlZCVcZBoBSjlDk3JT4ZCdjLkBXIOzNZBzzCBXLV1x5bFaYnmZA6J2wrJtF0tNi3bRyzW0Xt6iBHZA9KZBPOwbgKDSXEJZCNf7YPfZBkepFdelBgAYTnL1FbJKI124Ke9faVIFdNm7AHGwQ7t6w8jB0lRYuTSEGMjNgnZCQ8gctpJ7mTG8qBoO2XvizONRmAZDZD';

// Mapeamento de IDs de produto -> nome (pra log e content_name).
// Atualize com os IDs reais que a GGCheckout está usando pro funil de músicas atual.
// Se um ID não estiver aqui, o código já cai num fallback automático (Produto <primeiros 8 chars do ID>).
const productIdReference = {
  '8YKKoJQm474154JOFONX': 'PLAYLIST ATUALIZADA 14,90',
  'gGzJ7TRkfndUBm2RV1MN': 'MÚSICAS E CLIPES',
};

exports.handler = async (event, context) => {
  const clientIP = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || 'unknown';
  const userAgent = event.headers['user-agent'] || 'unknown';

  console.log('Headers recebidos:', {
    ip: clientIP,
    userAgent: userAgent,
    allHeaders: event.headers
  });

  try {
    let data;
    try {
      data = JSON.parse(event.body);
      console.log('Dados recebidos:', data);
    } catch (parseError) {
      console.error('Erro ao fazer parse do JSON:', parseError);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'JSON inválido', details: parseError.message })
      };
    }

    if (data.event === 'test') {
      console.log('Evento de teste recebido');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Evento de teste recebido com sucesso', timestamp: new Date().toISOString() })
      };
    }

    const isApprovedSale =
      data.event === 'pix.paid' ||
      (data.payment && (data.payment.status === 'approved' || data.payment.method === 'pix.paid'));

    if (!isApprovedSale) {
      console.log(`Evento não processado: ${data.event || 'undefined'}`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Evento recebido mas não processado',
          event_type: data.event || 'unknown',
          timestamp: new Date().toISOString()
        })
      };
    }

    console.log('PIX pago - enviando Purchase para Meta');

    const eventTime = Math.floor(Date.now() / 1000);
    const customer = data.customer || {};

    const hashedEmail = customer.email
      ? crypto.createHash('sha256').update(customer.email.toLowerCase().trim()).digest('hex')
      : null;

    const cleanPhone = customer.phone ? customer.phone.replace(/\D/g, '') : null;
    const hashedPhone = cleanPhone
      ? crypto.createHash('sha256').update(cleanPhone).digest('hex')
      : null;

    // FBC/FBP — só usa se vier ORIGINAL do payload, nunca gera artificial
    const fbc =
      data.tracking?.fbc || data.utm?.fbc || data.params?.fbc || data.custom_fields?.fbc || null;
    const fbp =
      data.tracking?.fbp || data.utm?.fbp || data.params?.fbp || data.custom_fields?.fbp || null;

    if (fbc) console.log('✅ FBC capturado (original):', fbc);
    else console.log('⚠️ FBC não encontrado - Evento sem atribuição direta');
    if (fbp) console.log('✅ FBP capturado:', fbp);

    const externalId = data.payment?.id || data.checkout_id || `purchase_${eventTime}`;

    const products = data.products || [];
    let contents;
    let totalValue;
    let productName = 'Produto via WhatsApp';

    if (products.length > 0 && products[0].id) {
      const realValue = parseFloat(data.payment?.amount) || 0;
      const pricePerProduct = realValue / products.length;

      contents = products.map(product => {
        const prodId = product.id?.toString() || 'unknown';
        const prodName = productIdReference[prodId] || `Produto ${prodId.substring(0, 8)}`;
        console.log(`📦 Produto: ${prodName} (ID: ${prodId}) - Valor unitário: R$ ${pricePerProduct.toFixed(2)}`);
        return { id: prodId, quantity: 1, item_price: pricePerProduct };
      });

      totalValue = realValue;
      productName = productIdReference[products[0].id] || 'Produto via WhatsApp';
    } else {
      const realValue = parseFloat(data.payment?.amount) || parseFloat(data.total) || 0;
      contents = [{
        id: data.product?.id?.toString() || 'single_product',
        quantity: 1,
        item_price: realValue
      }];
      totalValue = realValue;
      if (data.product?.id && productIdReference[data.product.id]) {
        productName = productIdReference[data.product.id];
      }
      console.log(`📦 Produto único - Valor real: R$ ${realValue.toFixed(2)}`);
    }

    console.log(`💰 Valor total enviado para Meta: R$ ${totalValue.toFixed(2)}`);

    const userData = {
      ...(hashedEmail && { em: [hashedEmail] }),
      ...(hashedPhone && { ph: [hashedPhone] }),
      ...(clientIP !== 'unknown' && { client_ip_address: clientIP }),
      ...(userAgent !== 'unknown' && { client_user_agent: userAgent }),
      ...(fbc && { fbc: fbc }),
      ...(fbp && { fbp: fbp }),
      external_id: [crypto.createHash('sha256').update(externalId).digest('hex')],
      country: [crypto.createHash('sha256').update('br').digest('hex')],
      ...(customer.name && {
        fn: [crypto.createHash('sha256').update(customer.name.split(' ')[0].toLowerCase().trim()).digest('hex')],
        ln: [crypto.createHash('sha256').update((customer.name.split(' ').slice(-1)[0] || '').toLowerCase().trim()).digest('hex')]
      }),
      ...(customer.city && { ct: [crypto.createHash('sha256').update(customer.city.toLowerCase().trim()).digest('hex')] }),
      ...(customer.state && { st: [crypto.createHash('sha256').update(customer.state.toLowerCase().trim()).digest('hex')] })
    };

    const purchaseEvent = {
      data: [{
        event_name: 'Purchase',
        event_time: eventTime,
        action_source: 'website',
        event_source_url: data.checkout_url || `https://checkout.ggcheckout.com/${data.checkout_id || 'unknown'}`,
        user_data: userData,
        custom_data: {
          currency: 'BRL',
          value: parseFloat(totalValue.toFixed(2)),
          contents: contents,
          content_type: 'product',
          num_items: contents.length,
          content_name: productName,
          order_id: externalId
        }
      }]
    };

    console.log('🎯 Enviando evento para Meta:', JSON.stringify(purchaseEvent, null, 2));

    const response = await fetch(`https://graph.facebook.com/v24.0/${PIXEL_ID}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...purchaseEvent, access_token: ACCESS_TOKEN })
    });

    const result = await response.json();

    if (response.ok) {
      console.log('✅ Evento enviado com sucesso!', result);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Purchase event enviado para o Meta',
          meta_response: result,
          event_data: {
            value: totalValue,
            currency: 'BRL',
            products_count: contents.length,
            order_id: externalId,
            fbc_used: userData.fbc || 'none'
          },
          timestamp: new Date().toISOString()
        })
      };
    } else {
      console.error('❌ Erro ao enviar para o Meta:', result);
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Erro ao enviar evento para o Meta', meta_error: result })
      };
    }
  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Erro interno do servidor', details: error.message })
    };
  }
};
