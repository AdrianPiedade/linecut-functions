const {onValueCreated, onValueUpdated} = require("firebase-functions/v2/database");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

async function sendAndSaveNotification(userId, title, body, icon = "bi-info-circle") {
  try {
    const saoPauloTimezone = "America/Sao_Paulo";
    const nowUtc = new Date();

    const nowLocalStr = new Intl.DateTimeFormat("pt-BR", {
      timeZone: saoPauloTimezone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(nowUtc).replace(", ", " às ");

    const notificationData = {
      title: title,
      body: body,
      icon: icon,
      is_read: false,
      timestamp_iso: nowUtc.toISOString(),
      timestamp_display: nowLocalStr,
    };

    const notifRef = admin.database().ref(`/notifications/${userId}`).push();
    await notifRef.set(notificationData);

    const countRef = admin.database().ref(`/notifications/${userId}/unread_count`);
    await countRef.transaction((currentCount) => (currentCount || 0) + 1);

    const userTokensSnapshot = await admin.database()
        .ref(`/empresas/${userId}/fcm_tokens`).get();
    if (!userTokensSnapshot.exists()) {
      logger.log(`Usuário ${userId} não possui tokens FCM.`);
      return;
    }

    const tokensMap = userTokensSnapshot.val();
    const validTokens = Object.keys(tokensMap);

    if (validTokens.length === 0) {
      logger.log(`Nenhum token FCM válido para ${userId}.`);
      return;
    }

    const message = {
      notification: {title, body},
      webpush: {
        notification: {
          icon: "/static/dashboard/images/logo_linecut_title.png",
          badge: "/static/dashboard/images/logo_linecut_title.png",
        },
      },
      tokens: validTokens,
    };

    const response = await admin.messaging().sendMulticast(message);
    logger.log(`Notificações enviadas para ${userId}: ${response.successCount} sucesso(s).`);
  } catch (error) {
    logger.error(`Erro em sendAndSaveNotification para ${userId}:`, error);
  }
}

exports.onOrderCancelledByClient = onValueUpdated(
    "/pedidos_por_lanchonete/{lanchoneteId}/{orderId}",
    async (event) => {
      const beforeData = event.data.before.val();
      const afterData = event.data.after.val();

      if (beforeData.status !== "cancelado" && afterData.status === "cancelado") {
        const lanchoneteId = event.params.lanchoneteId;
        const orderId = event.params.orderId;

        let reason = "Motivo não informado";
        try {
          const mainOrderSnapshot = await admin.database()
              .ref(`/pedidos/${orderId}/motivo_cancelamento`).get();
          if (mainOrderSnapshot.exists()) {
            reason = mainOrderSnapshot.val();
          }
        } catch (e) {
          logger.log("Motivo de cancelamento não encontrado no nó /pedidos.");
        }

        if (reason === "Cancelado pelo restaurante") {
          logger.log("Pedido cancelado pelo restaurante, notificação já enviada pelo Django.");
          return null;
        }

        const title = `Pedido #${orderId.slice(-8)} Cancelado`;
        const body = `O pedido foi cancelado pelo cliente. Motivo: ${reason}`;

        return sendAndSaveNotification(lanchoneteId, title, body, "bi-x-circle-fill");
      }
      return null;
    },
);

exports.onStockChangeByOrder = onValueUpdated(
    "/restaurants/{restaurantId}/products/{productId}/quantity",
    async (event) => {
      const restaurantId = event.params.restaurantId;
      const productId = event.params.productId;

      const newQuantity = event.data.after.val();
      const lastQuantity = event.data.before.val();

      if (newQuantity === null || lastQuantity === null) return null;

      const productSnapshot = await admin.database()
          .ref(`/restaurants/${restaurantId}/products/${productId}`).get();
      if (!productSnapshot.exists()) return null;

      const productData = productSnapshot.val();
      const criticalQuantity = productData.critical_quantity;
      const productName = productData.name || "Produto";

      if (criticalQuantity && newQuantity < lastQuantity) {
        if (newQuantity <= criticalQuantity && lastQuantity > criticalQuantity) {
          const title = "Estoque Crítico";
          const body = `O estoque de '${productName}' atingiu o nível crítico (${newQuantity} unidades).`;
          return sendAndSaveNotification(restaurantId, title, body, "bi-exclamation-triangle-fill");
        }
      }
      return null;
    },
);

exports.onStoreStatusChange = onValueUpdated(
    "/empresas/{userId}/status",
    async (event) => {
      const newStatus = event.data.after.val();
      const oldStatus = event.data.before.val();

      if (oldStatus === "fechado" && newStatus === "aberto") {
        const userId = event.params.userId;

        const scheduleSnapshot = await admin.database()
            .ref(`/empresas/${userId}/horario_funcionamento`).get();
        if (!scheduleSnapshot.exists()) {
          logger.log(`Usuário ${userId} abriu a loja sem horário configurado.`);
          return null;
        }
        const schedule = scheduleSnapshot.val();

        const saoPauloTimezone = "America/Sao_Paulo";
        const now = new Date();
        const nowLocal = new Date(now.toLocaleString("en-US", {timeZone: saoPauloTimezone}));

        const dayKey = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"][nowLocal.getDay()];
        const currentTimeStr = nowLocal.toTimeString().split(" ")[0].substring(0, 5); // "HH:MM"

        const horarioDia = schedule[dayKey];
        let estaForaDoHorario = true;

        if (horarioDia && horarioDia.aberto === true) {
          const abertura = horarioDia.abertura;
          const fechamento = horarioDia.fechamento;
          if (currentTimeStr >= abertura && currentTimeStr <= fechamento) {
            estaForaDoHorario = false;
          }
        }

        if (estaForaDoHorario) {
          const title = "Alerta de Horário";
          const body = "Sua loja foi aberta, mas parece estar fora do seu horário de funcionamento cadastrado.";
          return sendAndSaveNotification(userId, title, body, "bi-alarm-fill");
        }
      }
      return null;
    },
);

exports.onLegalTextUpdate = onValueUpdated(
    "/textos_legais/{documentId}",
    async (event) => {
      const documentId = event.params.documentId;
      const afterData = event.data.after.val();

      const title = afterData.titulo || (documentId === "termos_condicoes" ? "Termos e Condições" : "Política de Privacidade");
      const body = `Nossos ${title} foram atualizados. Por favor, revise as novas condições quando puder.`;

      const allCompaniesSnapshot = await admin.database().ref("/empresas").get();
      if (!allCompaniesSnapshot.exists()) {
        logger.log("Broadcast: Nenhuma empresa encontrada.");
        return null;
      }

      const allCompanyIds = Object.keys(allCompaniesSnapshot.val());
      const promises = allCompanyIds.map((userId) =>
        sendAndSaveNotification(userId, title, body, "bi-file-earmark-text-fill"),
      );

      return Promise.all(promises);
    },
);

exports.checkOverdueOpenStores = onSchedule(
    {
      schedule: "every 30 minutes",
      timeZone: "America/Sao_Paulo",
    },
    async (event) => {
      const saoPauloTimezone = "America/Sao_Paulo";
      const now = new Date();
      const nowLocal = new Date(now.toLocaleString("en-US", {timeZone: saoPauloTimezone}));

      const dayKey = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"][nowLocal.getDay()];
      const currentTimeStr = nowLocal.toTimeString().split(" ")[0].substring(0, 5);
      const todayDateStr = nowLocal.toISOString().split("T")[0];

      logger.log(`Verificando lojas abertas fora do horário: ${dayKey} ${currentTimeStr}`);

      const openStoresSnapshot = await admin.database().ref("/empresas")
          .orderByChild("status")
          .equalTo("aberto")
          .get();

      if (!openStoresSnapshot.exists()) {
        logger.log("Nenhuma loja aberta encontrada.");
        return null;
      }

      const openStores = openStoresSnapshot.val();
      const promises = [];

      for (const userId in openStores) {
        if (Object.prototype.hasOwnProperty.call(openStores, userId)) {
          const storeData = openStores[userId];
          const schedule = storeData.horario_funcionamento;
          if (!schedule) continue;

          const horarioDia = schedule[dayKey];
          let estaForaDoHorario = false;

          if (horarioDia && horarioDia.aberto === true) {
            const fechamento = horarioDia.fechamento;
            if (currentTimeStr > fechamento) {
              estaForaDoHorario = true;
            }
          } else {
            estaForaDoHorario = true;
          }

          if (estaForaDoHorario) {
            const lastWarningStr = storeData.lastOverdueWarningSent || "";
            const lastWarningDate = lastWarningStr.split("T")[0];

            if (lastWarningDate !== todayDateStr) {
              logger.log(`Loja ${userId} está aberta fora do horário. Enviando notificação.`);
              const title = "Loja Aberta Fora do Horário";
              const body = "Sua loja ainda está aberta, mas passou do horário de fechamento. Verifique se esqueceu de fechá-la.";

              promises.push(sendAndSaveNotification(userId, title, body, "bi-alarm-fill"));

              promises.push(admin.database().ref(`/empresas/${userId}`).update({
                lastOverdueWarningSent: now.toISOString(),
              }));
            }
          }
        }
      }
      return Promise.all(promises);
    },
);