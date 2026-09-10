// Azure AI Search.
//
// Tier note: the Free tier is one per subscription and was already taken in the
// target subscription, so this defaults to the Serverless Developer tier
// (preview) — consumption-based, compute drops to zero when an index goes
// inactive after 10 minutes, and only storage bills continuously.
//
// The `serverless` SKU is not selectable via `az search service create`
// (the CLI's --sku enum predates it) but ARM and Bicep accept it. A good
// reminder that the CLI is not the API.

param location string
param tags object
param resourceToken string

@description('serverless = Serverless Developer (preview). Switch to basic for a GA tier with an SLA, private endpoints and shared private links.')
@allowed([
  'serverless'
  'free'
  'basic'
  'standard'
])
param sku string = 'serverless'

@description('aadOrApiKey accepts both keys and Entra tokens. Once role assignments are possible, switch this to aad to turn keys off entirely.')
@allowed([
  'aadOrApiKey'
  'aad'
  'apiKey'
])
param authMode string = 'aadOrApiKey'

var isDedicated = sku != 'serverless' && sku != 'free'

resource search 'Microsoft.Search/searchServices@2025-05-01' = {
  name: 'srch-${resourceToken}'
  location: location
  tags: tags
  sku: {
    name: sku
  }
  // The search service needs its own identity so indexers can reach Blob
  // Storage and Foundry without keys.
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    // Serverless and free tiers have no replicas or partitions to configure.
    replicaCount: isDedicated ? 1 : null
    partitionCount: isDedicated ? 1 : null
    publicNetworkAccess: 'Enabled'
    authOptions: authMode == 'aad' ? null : {
      aadOrApiKey: {
        aadAuthFailureMode: 'http401WithBearerChallenge'
      }
    }
    disableLocalAuth: authMode == 'aad'
  }
}

output name string = search.name
output endpoint string = 'https://${search.name}.search.windows.net'
output resourceId string = search.id
output principalId string = search.identity.principalId
