// Storage account holding the source documents the search indexer pulls from.
//
// The three hardening flags below are the ones the NIST 800-171 and ASC Default
// policy initiatives on this subscription look for. Getting them right at
// creation avoids a compliance finding you'd otherwise have to remediate.

param location string
param tags object
param resourceToken string

@description('Container the indexer uses as its data source.')
param docsContainerName string = 'docs'

resource storage 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: 'st${resourceToken}'
  location: location
  tags: tags
  sku: {
    // Locally redundant: cheapest, and the seed corpus is reproducible.
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    // Blocks anonymous read at the account level regardless of per-container
    // settings — defence against someone flipping a container to public later.
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    publicNetworkAccess: 'Enabled'
    accessTier: 'Hot'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: storage
  name: 'default'
  properties: {}
}

resource docsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: docsContainerName
  properties: {
    publicAccess: 'None'
  }
}

output name string = storage.name
output resourceId string = storage.id
output blobEndpoint string = storage.properties.primaryEndpoints.blob
output docsContainerName string = docsContainer.name
