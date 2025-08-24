const crypto = require('crypto');
const fetch = require("node-fetch");

exports.handler = async (event) => {
  console.log('Dados recebidos:', JSON.parse(event.body));
  
  // Configurações do Meta Pixel
  const PIXEL_ID = '1200923827459530';
  const ACCESS_TOKEN = 'EAALM996YCYEBPXWSgjIIgFPBn8sVgm8B7LSgw9jlp9WqpKZAq0uWuLqB51jPU0Ji7nZBy9y3XLXqZAGGdC4ifzEEZCZBJcY3vxX429B95Qbfsq5setZATxmVi7UcHhx0itmvZBoUZBLJksESxnRRkPQmr3TyhdghR5Fc9zrU25PuU9hepRIZA0ZAZCfBTQHzPirmWrUpvMwu1QVOZBMkUfGdloXyCvdo';
  
  try {
    const data = JSON.parse(event.body);
    
    // Verificar se é um evento de teste
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
    
    // Verificar se é um evento de pagamento PIX pago ou aprovado
    if (data.event === 'pix.paid' || 
        (data.payment && (data.payment.status === 'approved' || data.payment.method === 'pix.paid'))) {
      
      console.log('PIX pago - enviando Purchase para Meta');
      
      const eventTime = Math.floor(Date.now() / 1000);
      const customer = data.customer || {};
      
      // Hash obrigatório do email e telefone (requisito do Meta para LGPD/GDPR)
      const hashedEmail = customer.email 
        ? crypto.createHash('sha256').update(customer.email.toLowerCase().trim()).digest('hex')
        : null;
      
      // Limpar telefone (remover caracteres especiais) e fazer hash
      const cleanPhone = customer.phone 
        ? customer.phone.replace(/\D/g, '') 
        : null;
      const hashedPhone = cleanPhone 
        ? crypto.createHash('sha256').update(cleanPhone).digest('hex')
        : null;
      
      // Preparar produtos corretamente
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
      
      // Calcular valor total correto
      const totalValue = data.payment?.amount || data.total || 
        contents.reduce((sum, item) => sum + (item.item_price * item.quantity), 0);
      
      // Evento Purchase otimizado para WhatsApp/Coora
      const purchaseEvent = {
        data: [{
          event_name: 'Purchase',
          event_time: eventTime,
          action_source: 'other', // 'other' é mais apropriado para WhatsApp
          user_data: {
            ...(hashedEmail && { em: [hashedEmail] }),
            ...(hashedPhone && { ph: [hashedPhone] }),
            // Adicionar dados extras se disponíveis
            ...(customer.name && { 
              fn: [crypto.createHash('sha256').update(customer.name.split(' ')[0].toLowerCase().trim()).digest('hex')],
              ln: [crypto.createHash('sha256').update((customer.name.split(' ').slice(-1)[0] || '').toLowerCase().trim()).digest('hex')]
            })
          },
          custom_data: {
            currency: 'BRL',
            value: parseFloat(totalValue),
            contents: contents,
            content_type: 'product',
            num_items: contents.length,
            // Adicionar nome do produto principal
            content_name: products.length > 0 ? products[0].name : 'Produto via WhatsApp',
            // Adicionar categoria se disponível
            ...(products.length > 0 && products[0].category && {
              content_category: products[0].category
            })
          },
          // Adicionar source_url se for via WhatsApp
          event_source_url: 'whatsapp://business'
        }]
      };
      
      console.log('Enviando evento para Meta:', JSON.stringify(purchaseEvent, null, 2));
      
      // Enviar para o Meta Pixel
      const response = await fetch(`https://graph.facebook.com/v18.0/${PIXEL_ID}/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...purchaseEvent,
          access_token: ACCESS_TOKEN,
          // Adicionar parâmetros adicionais para melhor rastreamento
          test_event_code: process.env.META_TEST_CODE || undefined // Para testes
        })
      });
      
      const result = await response.json();
      
      if (response.ok) {
        console.log('Evento enviado com sucesso para o Meta:', result);
        return {
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            message: 'Purchase event enviado com sucesso para o Meta',
            meta_response: result,
            event_data: {
              value: totalValue,
              currency: 'BRL',
              products_count: contents.length
            },
            timestamp: new Date().toISOString()
          })
        };
      } else {
        console.error('Erro ao enviar para o Meta:', result);
        return {
          statusCode: 400,
          body: JSON.stringify({
            success: false,
            error: 'Erro ao enviar evento para o Meta',
            meta_error: result,
            event_attempted: purchaseEvent
          })
        };
      }
      
    } else {
      console.log(`Evento não é um pagamento aprovado: ${data.event || 'undefined'} - Status: ${data.payment?.status || 'undefined'}`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: `Evento recebido mas não processado`,
          event_type: data.event || 'unknown',
          payment_status: data.payment?.status || 'unknown',
          timestamp: new Date().toISOString()
        })
      };
    }
    
  } catch (error) {
    console.error('Erro no webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: 'Erro interno do servidor',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};
