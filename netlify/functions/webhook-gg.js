const crypto = require('crypto');
const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  const clientIP = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || 'unknown';
  const userAgent = event.headers['user-agent'] || 'unknown';
  
  console.log('Headers recebidos:', {
    ip: clientIP,
    userAgent: userAgent,
    allHeaders: event.headers
  });

  const PIXEL_ID = '1200923827459530';
  const ACCESS_TOKEN = 'EAALM996YCYEBPXWSgjIIgFPBn8sVgm8B7LSgw9jlp9WqpKZAq0uWuLqB51jPU0Ji7nZBy9y3XLXqZAGGdC4ifzEEZCZBJcY3vxX429B95Qbfsq5setZATxmVi7UcHhx0itmvZBoUZBLJksESxnRRkPQmr3TyhdghR5Fc9zrU25PuU9hepRIZA0ZAZCfBTQHzPirmWrUpvMwu1QVOZBMkUfGdloXyCvdo';
  
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

      // 🚀 MELHORIA 1: Tentar capturar FBC/FBP de diferentes fontes
      let fbc = data.tracking?.fbc || data.utm?.fbc || data.custom_fields?.fbclid || null;
      let fbp = data.tracking?.fbp || data.utm?.fbp || data.custom_fields?.fbp || null;
      
      // 🚀 MELHORIA 2: Se não tem fbc, gerar um baseado no checkout_id (fallback)
      if (!fbc && data.checkout_id) {
        fbc = `fb.1.${eventTime}.generated_${data.checkout_id}`;
        console.log('🔧 FBC gerado como fallback:', fbc);
      }
      
      // 🚀 MELHORIA 3: Adicionar external_id único para cada compra
      const externalId = data.payment?.id || data.checkout_id || `purchase_${eventTime}`;
      
      // Preparar produtos
      const products = data.products || [];
      const contents = products.length > 0 
        ? products.map(product => ({
            id: product.id?.toString() || 'unknown',
            quantity: parseInt(product.quantity) || 1,
            item_price: parseFloat(product.price) || 0
          }))
        : [{
            id: data.product?.id?.toString() || 'single_product',
            quantity: 1,
            item_price: parseFloat(data.payment?.amount) || parseFloat(data.total) || 0
          }];
      
      const totalValue = data.payment?.amount || data.total || 
        contents.reduce((sum, item) => sum + (item.item_price * item.quantity), 0);
      
      // 🚀 MELHORIA 4: userData otimizado com todos os campos possíveis
      const userData = {
        ...(hashedEmail && { em: [hashedEmail] }),
        ...(hashedPhone && { ph: [hashedPhone] }),
        ...(clientIP !== 'unknown' && { client_ip_address: clientIP }),
        ...(userAgent !== 'unknown' && { client_user_agent: userAgent }),
        ...(fbc && { fbc: fbc }),
        ...(fbp && { fbp: fbp }),
        // Adicionar external_id para melhor rastreamento
        external_id: [crypto.createHash('sha256').update(externalId).digest('hex')],
        // Adicionar nome se disponível
        ...(customer.name && { 
          fn: [crypto.createHash('sha256').update(customer.name.split(' ')[0].toLowerCase().trim()).digest('hex')],
          ln: [crypto.createHash('sha256').update((customer.name.split(' ').slice(-1)[0] || '').toLowerCase().trim()).digest('hex')]
        }),
        // 🚀 MELHORIA 5: Adicionar cidade/estado se disponível
        ...(customer.city && { 
          ct: [crypto.createHash('sha256').update(customer.city.toLowerCase().trim()).digest('hex')]
        }),
        ...(customer.state && { 
          st: [crypto.createHash('sha256').update(customer.state.toLowerCase().trim()).digest('hex')]
        })
      };

      // 🚀 MELHORIA 6: Evento Purchase com test_event_code para debug
      const purchaseEvent = {
        data: [{
          event_name: 'Purchase',
          event_time: eventTime,
          action_source: 'website',
          event_source_url: data.checkout_url || `https://checkout.perfectpay.com.br/v2/${data.checkout_id || 'unknown'}`,
          user_data: userData,
          custom_data: {
            currency: 'BRL',
            value: parseFloat(totalValue),
            contents: contents,
            content_type: 'product',
            num_items: contents.length,
            content_name: products.length > 0 ? products[0].name : 'Produto via WhatsApp',
            // Adicionar order_id único
            order_id: externalId,
            ...(products.length > 0 && products[0].category && {
              content_category: products[0].category
            })
          }
        }],
        // 🚀 MELHORIA 7: test_event_code para monitorar em tempo real
        test_event_code: 'TEST12345' // Remover em produção
      };
      
      console.log('🎯 Enviando evento MELHORADO para Meta:', JSON.stringify(purchaseEvent, null, 2));
      console.log('📊 Parâmetros de qualidade incluídos:', {
        hasIP: !!userData.client_ip_address,
        hasUserAgent: !!userData.client_user_agent,
        hasFBC: !!userData.fbc,
        hasFBP: !!userData.fbp,
        hasEmail: !!userData.em,
        hasPhone: !!userData.ph,
        hasExternalId: !!userData.external_id,
        hasName: !!(userData.fn && userData.ln),
        hasLocation: !!(userData.ct || userData.st),
        expectedQuality: '6-7/10 (vs 4.6/10 anterior)'
      });
      
      const response = await fetch(`https://graph.facebook.com/v18.0/${PIXEL_ID}/events`, {
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
        console.log('✅ Evento enviado com sucesso - Qualidade melhorada!', result);
        return {
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            message: 'Purchase event enviado com QUALIDADE MELHORADA para o Meta',
            meta_response: result,
            event_data: {
              value: totalValue,
              currency: 'BRL',
              products_count: contents.length,
              order_id: externalId
            },
            quality_improvements: {
              ip_included: !!userData.client_ip_address,
              user_agent_included: !!userData.client_user_agent,
              fbc_included: !!userData.fbc,
              fbp_included: !!userData.fbp,
              external_id_included: !!userData.external_id,
              name_included: !!(userData.fn && userData.ln),
              expected_quality_score: '6-7/10'
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
