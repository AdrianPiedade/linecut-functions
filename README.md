# 🚀 LineCut - Firebase Functions

Este repositório contém as Cloud Functions (gatilhos de backend) para o projeto LineCut. Elas rodam nos servidores do Google e respondem a eventos em tempo real no Firebase Realtime Database, complementando a aplicação principal em Django.

---

## ⚙️ Principais Funções (Gatilhos)

Este projeto implementa "listeners" que rodam 24/7 para monitorar eventos que acontecem fora do painel de controle do Django:

* **`onNewOrder`**: Notifica a lanchonete sobre um novo pedido assim que ele é criado.
* **`onOrderCancelledByClient`**: Notifica a lanchonete se um cliente cancelar um pedido.
* **`onStockChangeByOrder`**: Dispara um alerta de "Estoque Crítico" se um pedido de cliente fizer com que a quantidade de um item caia abaixo do limite crítico definido.
* **`onStoreStatusChange`**: Alerta o proprietário se ele abrir a loja fora do seu horário de funcionamento cadastrado.
* **`onLegalTextUpdate`**: (Broadcast) Envia uma notificação para **todas** as lanchonetes quando os Termos de Uso ou a Política de Privacidade são alterados no banco de dados.
* **`checkOverdueOpenStores`**: (Agendada) Roda a cada 30 minutos para verificar se alguma loja foi *esquecida* aberta após o horário de fechamento e envia um lembrete.

---

## 📦 Requisitos

* [Node.js](https://nodejs.org/) (v18 ou superior)
* [Firebase CLI](https://firebase.google.com/docs/cli): `npm install -g firebase-tools`
* [Google Cloud SDK (gcloud)](https://cloud.google.com/sdk/docs/install) (Necessário para o primeiro deploy para corrigir permissões).

---

## 🛠️ Instalação Local

1.  Clone o repositório:
    ```bash
    git clone [https://github.com/adrianpiedade/linecut-functions.git](https://github.com/adrianpiedade/linecut-functions.git)
    ```
2.  Entre na pasta de funções (onde está o `package.json`):
    ```bash
    cd linecut-functions/functions
    ```
3.  Instale todas as dependências do Node.js:
    ```bash
    npm install
    ```

---

## 🚀 Deploy

Para enviar as funções para a nuvem do Firebase:

1.  Autentique-se com o Firebase (abrirá um navegador):
    ```bash
    firebase login
    ```
2.  (Opcional) Verifique se você está usando o projeto correto:
    ```bash
    firebase use linecut-3bf2b
    ```
3.  Faça o deploy de todas as funções:
    ```bash
    firebase deploy --only functions
    ```

---

## 🚨 Solução de Problemas (Importante para o Primeiro Deploy)

Ao fazer o deploy pela **primeira vez** de funções V2 (especialmente as agendadas), é comum que o Google Cloud precise de permissões extras que o Firebase CLI não consegue conceder sozinho.

Se o seu deploy falhar com erros de **`IAM policy`** ou **`Eventarc Service Agent`**, você precisará rodar os seguintes comandos `gcloud` **uma única vez** para autorizar os serviços do Google Cloud a conversarem entre si.

**1. Erro de `IAM policy` / `pubsub`:**
Se o log mostrar `We failed to modify the IAM policy for the project...`, rode estes comandos:

   ```bash
   gcloud projects add-iam-policy-binding linecut-3bf2b --member=serviceAccount:service-140700221422@gcp-sa-pubsub.iam.gserviceaccount.com --role=roles/iam.serviceAccountTokenCreator