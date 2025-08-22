const crypto = require('crypto');

exports.handler = async (event, context) => {
  console.log('Dados recebidos:', JSON.parse(event.body));
  
  // Configurações do Meta Pixel
  const PIXEL_ID = '1200923827459530';
  const ACCESS_TOKEN = 'EAALM996YCYEBPXWSgjIIgFPBn8sVgm8B7LSgw9jlp9WqpKZAq0uWuLqB51jPU0Ji7nZBy9y3XLXqZAGGdC4ifzEEZCZBJcY3vxX429B95Qbfsq5setZATxmVi7UcHhx0itmvZBoUZBLJksESxnRRkPQmr3TyhdghR5Fc9zrU25PuU9hepRIZA0ZAZCfBTQHzPirmWrUpvMwu1QVOZBMkUfGdloXyCvdo';
  
  try {
    const data = JSON.parse(event.body);
    
    // Verificar se é um evento válido (não apenas teste)
    if (data.event === 'test') {
      console.log('Evento de teste recebido - não enviando para Meta');
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Evento de teste recebido com sucesso',
          timestamp: new Date().toISOString()
        })
      };
    }
    
    // Verificar se é um evento de pagamento PIX pago
    if (data.event === 'pix.paid' || (data.payment && (data.payment.status === 'approved' || data.payment.method === 'pix.paid'))) {
      console.log('PIX pago - enviando Purchase para Meta');
      
      // Preparar dados para o Meta
      const eventTime = Math.floor(Date.now() / 1000);
      
      // Hash do email e telefone (obrigatório para o Meta)
      const hashedEmail = data.customer.email 
        ? crypto.createHash('sha256').update(data.customer.email.toLowerCase()).digest('hex')
        : null;
      
      const hashedPhone = data.customer.phone 
        ? crypto.createHash('sha256').update(data.customer.phone.replace(/\D/g, '')).digest('hex')
        : null;
      
      // Preparar produtos - ajustado para estrutura do GGCheckout
      const contents = data.products ? data.products.map(product => ({
        id: product.id,
        quantity: product.quantity || 1,
        item_price: product.price
      })) : [{
        id: data.product.id,
        quantity: 1,
        item_price: data.payment.amount
      }];
      
      // Evento Purchase para o Meta
      const purchaseEvent = {
        data: [{
          event_name: 'Purchase',
          event_time: eventTime,
          action_source: 'website',
          user_data: {
            ...(hashedEmail && { em: [hashedEmail] }),
            ...(hashedPhone && { ph: [hashedPhone] })
          },
          custom_data: {
            currency: 'BRL',
            value: data.payment.amount,
            contents: contents,
            content_type: 'product',
            num_items: data.products ? data.products.length : 1
          }
        }]
      };
      
      // Enviar para o Meta
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
        console.log('Evento enviado com sucesso para o Meta:', result);
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: 'Purchase event enviado com sucesso para o Meta',
            meta_response: result,
            timestamp: new Date().toISOString()
          })
        };
      } else {
        console.error('Erro ao enviar para o Meta:', result);
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: 'Erro ao enviar evento para o Meta',
            meta_error: result
          })
        };
      }
    } else {
      console.log(`Status do pagamento: ${data.payment?.status} - não enviando evento`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: `Evento recebido mas não processado (status: ${data.payment?.status})`,
          timestamp: new Date().toISOString()
        })
      };
    }
    
  } catch (error) {
    console.error('Erro no webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Erro interno do servidor',
        details: error.message
      })
    };
  }
};
