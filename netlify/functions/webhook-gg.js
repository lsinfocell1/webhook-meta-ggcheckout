const crypto = require('crypto');

exports.handler = async (event, context) => {
  const clientIP = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || 'unknown';
  const userAgent = event.headers['user-agent'] || 'unknown';
  
  console.log('Headers recebidos:', {
    ip: clientIP,
    userAgent: userAgent,
    allHeaders: event.headers
  });

  const PIXEL_ID = '1200923827459530';
  const ACCESS_TOKEN = 'EAA9DJQFrmiYBP5CtL8ZAmdBPCq9naYKqZAMIbgH8EPorfD9GK61XPigExqFzM8mtjDr7MxMo4aB01H7O3m4PjybOTsVnc8HBWisuxgaZC8AjNshgZAVI6SRtglweVTZBRTF7kQy5PmjDZAp5nCANO0pr7PzZCA48Nk0E6nZBtaZAYXVZClhj9dDAUp3FcVdUo8lQN00gZDZD';
  
  // Mapeamento de IDs para referência nos logs
  const productIdReference = {
    '8YKKoJQm474154JOFONX': 'PLAYLIST ATUALIZADA OUTUBRO 2025',
    'gGzJ7TRkfndUBm2RV1MN': 'MÚSICAS E CLIPES'
  };
  
  try {
    let data;
    try {
      data = JSON.parse(event.body);
      console.log('Dados recebidos:', data);
    } catch (parseError) {
      console.error('Erro ao fazer parse do JSON:', parseError);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'JSON inválido',
          details: parseError.message
        })
      };
    }
    
    if (data.event === 'test') {
      console.log('Evento de teste recebido');
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Evento de teste recebido com sucesso',
          timestamp: new Date().toISOString()
        })
      };
    }
    
    if (data.event === 'pix.paid' || 
        (data.payment && (data.payment.status === 'approved' || data.payment.method === 'pix.paid'))) {
      
      console.log('PIX pago - enviando Purchase para Meta');
      
      const eventTime = Math.floor(Date.now() / 1000);
      const customer = data.customer || {};
      
      // Hash do email e telefone
      const hashedEmail = customer.email 
        ? crypto.createHash('sha256').update(customer.email.toLowerCase().trim()).digest('hex')
        : null;
      
      const cleanPhone = customer.phone 
        ? customer.phone.replace(/\D/g, '') 
        : null;
      const hashedPhone = cleanPhone 
        ? crypto.createHash('sha256').update(cleanPhone).digest('hex')
        : null;

      // ✅ CAPTURA CORRETA DE FBC/FBP - SEM MODIFICAÇÕES
      let fbc = null;
      let fbp = null;
      
      // Tentar pegar FBC diretamente (já formatado corretamente pela fonte)
      fbc = data.tracking?.fbc || 
            data.utm?.fbc || 
            data.params?.fbc || 
            data.custom_fields?.fbc || 
            null;
      
      if (fbc) {
        console.log('✅ FBC capturado (original):', fbc);
      } else {
        console.log('⚠️ FBC não encontrado - Evento sem atribuição direta');
      }
      
      // Pegar FBP
      fbp = data.tracking?.fbp || 
            data.utm?.fbp || 
            data.params?.fbp || 
            data.custom_fields?.fbp || 
            null;
      
      if (fbp) {
        console.log('✅ FBP capturado:', fbp);
      }
      
      // ❌ NÃO GERAR FBC ARTIFICIAL - DEIXAR NULO SE NÃO EXISTIR
      // O Facebook prefere eventos sem FBC do que com FBC falso/modificado
      
      // External_id único para cada compra
      const externalId = data.payment?.id || data.checkout_id || `purchase_${eventTime}`;
      
      // Lógica dinâmica: Usar valor REAL do pagamento
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
          
          return {
            id: prodId,
            quantity: 1,
            item_price: pricePerProduct
          };
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
      
      // ✅ UserData - SÓ INCLUI FBC/FBP SE REALMENTE EXISTIREM
      const userData = {
        ...(hashedEmail && { em: [hashedEmail] }),
        ...(hashedPhone && { ph: [hashedPhone] }),
        ...(clientIP !== 'unknown' && { client_ip_address: clientIP }),
        ...(userAgent !== 'unknown' && { client_user_agent: userAgent }),
        ...(fbc && { fbc: fbc }), // ✅ Só envia se existir ORIGINAL
        ...(fbp && { fbp: fbp }), // ✅ Só envia se existir ORIGINAL
        external_id: [crypto.createHash('sha256').update(externalId).digest('hex')],
        country: [crypto.createHash('sha256').update('br').digest('hex')], // ✅ País fixo BR (hasheado)
        ...(customer.name && { 
          fn: [crypto.createHash('sha256').update(customer.name.split(' ')[0].toLowerCase().trim()).digest('hex')],
          ln: [crypto.createHash('sha256').update((customer.name.split(' ').slice(-1)[0] || '').toLowerCase().trim()).digest('hex')]
        }),
        ...(customer.city && { 
          ct: [crypto.createHash('sha256').update(customer.city.toLowerCase().trim()).digest('hex')]
        }),
        ...(customer.state && { 
          st: [crypto.createHash('sha256').update(customer.state.toLowerCase().trim()).digest('hex')]
        })
      };

      // Evento Purchase
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
      console.log('📊 Parâmetros de qualidade:', {
        hasIP: !!userData.client_ip_address,
        hasUserAgent: !!userData.client_user_agent,
        hasFBC: !!userData.fbc,
        fbcValue: userData.fbc || 'NENHUM (normal para WhatsApp)',
        hasFBP: !!userData.fbp,
        hasEmail: !!userData.em,
        hasPhone: !!userData.ph,
        hasExternalId: !!userData.external_id,
        hasName: !!(userData.fn && userData.ln),
        totalValue: `R$ ${totalValue.toFixed(2)}`
      });
      
      const response = await fetch(`https://graph.facebook.com/v24.0/${PIXEL_ID}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...purchaseEvent,
          access_token: ACCESS_TOKEN
        })
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
              fbc_used: userData.fbc || 'none',
              products_processed: contents.map(item => ({
                id: item.id,
                price: item.item_price,
                quantity: item.quantity
              }))
            },
            quality_score: {
              ip_included: !!userData.client_ip_address,
              user_agent_included: !!userData.client_user_agent,
              fbc_included: !!userData.fbc,
              fbp_included: !!userData.fbp,
              external_id_included: !!userData.external_id,
              name_included: !!(userData.fn && userData.ln),
              dynamic_values: true
            },
            timestamp: new Date().toISOString()
          })
        };
      } else {
        console.error('❌ Erro ao enviar para o Meta:', result);
        return {
          statusCode: 400,
          body: JSON.stringify({
            success: false,
            error: 'Erro ao enviar evento para o Meta',
            meta_error: result
          })
        };
      }
      
    } else {
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
    
  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: 'Erro interno do servidor',
        details: error.message
      })
    };
  }
};
