// netlify/functions/webhook-gg.js
const crypto = require('crypto');

exports.handler = async (event, context) => {
  // Apenas POST é permitido
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Método não permitido' })
    };
  }

  // Suas credenciais Meta
  const PIXEL_ID = "1200923827459530";
  const TOKEN = "EAALM996YCYEBPXWSgjIIgFPBn8sVgm8B7LSgw9jlp9WqpKZAq0uWuLqB51jPU0Ji7nZBy9y3XLXqZAGGdC4ifzEEZCZBJcY3vxX429B95Qbfsq5setZATxmVi7UcHhx0itmvZBoUZBLJksESxnRRkPQmr3TyhdghR5Fc9zrU25PuU9hepRIZA0ZAZCfBTQHzPirmWrUpvMwu1QVOZBMkUfGdloXyCvdo";

  try {
    // Parse dos dados recebidos do GGCheckout
    const data = JSON.parse(event.body);
    
    console.log('Dados recebidos:', data);

    // Validação básica
    if (!data.customer || !data.order) {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Dados inválidos',
          received: data 
        })
      };
    }

    // Extrai informações
    const customerEmail = data.customer.email || '';
    const customerPhone = data.customer.phone || '';
    const orderAmount = parseFloat(data.order.amount || 0);
    const productName = data.product?.name || 'Produto';
    const orderId = data.order.id || '';

    // Prepara dados do usuário (hash para privacidade)
    const userData = {};
    
    if (customerEmail) {
      userData.em = [crypto.createHash('sha256').update(customerEmail.toLowerCase().trim()).digest('hex')];
    }
    
    if (customerPhone) {
      const cleanPhone = customerPhone.replace(/\D/g, '');
      userData.ph = [crypto.createHash('sha256').update(cleanPhone).digest('hex')];
    }

    // Monta evento para Meta API
    const eventData = {
      data: [{
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_source_url: "https://checkout.ggcheckout.com",
        user_data: userData,
        custom_data: {
          currency: "BRL",
          value: orderAmount,
          content_type: "product",
          content_name: productName,
          order_id: orderId
        }
      }],
      test_event_code: "TEST12345" // Remova quando for para produção
    };

    console.log('Enviando para Meta:', eventData);

    // Envia para Meta API de Conversões
    const metaResponse = await fetch(`https://graph.facebook.com/v18.0/${PIXEL_ID}/events?access_token=${TOKEN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GGCheckout-Netlify-Webhook/1.0'
      },
      body: JSON.stringify(eventData)
    });

    const responseData = await metaResponse.json();
    
    console.log('Resposta da Meta:', responseData);

    if (metaResponse.ok) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          success: true,
          message: "Evento enviado para Meta com sucesso",
          meta_response: responseData,
          event_data: {
            customer_email: customerEmail,
            order_amount: orderAmount,
            product_name: productName
          }
        })
      };
    } else {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Falha ao enviar para Meta",
          meta_response: responseData
        })
      };
    }

  } catch (error) {
    console.error('Erro:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Erro interno do servidor',
        details: error.message 
      })
    };
  }
};
