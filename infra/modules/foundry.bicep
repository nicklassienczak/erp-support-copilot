// Microsoft Foundry: one AIServices account + one project + two model deployments.
//
// This is the whole Foundry footprint. The portal's create wizard offers to
// provision Cosmos DB, AI Search and Storage alongside it — that's the
// "standard agent setup" for the Agent Service, which stores threads and files
// on your own resources. We don't use the Agent Service, so none of that
// appears here.

param location string
param tags object
param resourceToken string

@description('Globally unique custom subdomain. Becomes the endpoint hostname, so a collision fails with CustomDomainInUse.')
param accountName string = 'foundry-${resourceToken}'

param projectName string = 'erp-copilot'

@description('Chat model deployment. The deployment name is what the app sends as the `model` parameter — keeping it generic means swapping models is a portal change, not a code change.')
param chatDeploymentName string = 'chat'
param chatModelName string = 'gpt-5.4-mini'
param chatModelVersion string = '2026-03-17'
param chatCapacity int = 50

param embeddingDeploymentName string = 'embeddings'
param embeddingModelName string = 'text-embedding-3-small'
param embeddingModelVersion string = '1'
param embeddingCapacity int = 50

@description('Set true once role assignments are possible; then the app authenticates with Entra ID and keys stop working.')
param disableLocalAuth bool = false

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: accountName
  location: location
  tags: tags
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  // A managed identity is REQUIRED for project management. Without it,
  // project creation fails outright.
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    allowProjectManagement: true
    customSubDomainName: accountName
    disableLocalAuth: disableLocalAuth
    publicNetworkAccess: 'Enabled'
  }
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: account
  name: projectName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {}
}

resource chatDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: chatDeploymentName
  sku: {
    // GlobalStandard is cheapest but routes to capacity worldwide.
    // DataZoneStandard keeps processing in the EU — the right choice for a
    // client with data-residency requirements.
    name: 'GlobalStandard'
    capacity: chatCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: chatModelName
      version: chatModelVersion
    }
  }
}

resource embeddingDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: embeddingDeploymentName
  sku: {
    name: 'GlobalStandard'
    capacity: embeddingCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: embeddingModelName
      version: embeddingModelVersion
    }
  }
  // Deployments on the same account must be created serially — parallel
  // creation intermittently fails with a conflict. This dependency is load
  // bearing, not decoration.
  dependsOn: [
    chatDeployment
  ]
}

output accountName string = account.name
output accountId string = account.id
output endpoint string = account.properties.endpoint
output openAiEndpoint string = 'https://${accountName}.openai.azure.com/'
output projectName string = project.name
output chatDeploymentName string = chatDeployment.name
output embeddingDeploymentName string = embeddingDeployment.name
output principalId string = account.identity.principalId
