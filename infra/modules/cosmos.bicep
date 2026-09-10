// Cosmos DB for NoSQL — conversation history and usage events.
//
// Serverless rather than the subscription's one free-tier slot: the free tier
// is permanent, irreversible and shared across the whole subscription, so
// claiming it for a sandbox denies it to a real project. Serverless costs a few
// cents a month for this workload and bills nothing while idle.

param location string
param tags object
param resourceToken string

param databaseName string = 'copilot'

resource account 'Microsoft.DocumentDB/databaseAccounts@2025-05-01-preview' = {
  name: 'cosmos-${resourceToken}'
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    // Serverless is a capability, not a SKU — a Cosmos quirk worth knowing.
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    backupPolicy: {
      // Periodic is included; continuous backup is a separate meter.
      type: 'Periodic'
      periodicModeProperties: {
        backupIntervalInMinutes: 1440
        backupRetentionIntervalInHours: 8
        backupStorageRedundancy: 'Local'
      }
    }
    disableKeyBasedMetadataWriteAccess: false
    publicNetworkAccess: 'Enabled'
    minimalTlsVersion: 'Tls12'
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2025-05-01-preview' = {
  parent: account
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
    // No throughput block: serverless accounts must not specify one.
  }
}

// Partition key is the most consequential Cosmos design decision, and it is
// driven by the dominant query pattern.
//
// conversations  -> /userId : "list my conversations" and "load one
//                             conversation" are both single-partition. One
//                             document per conversation, messages in an array.
// usage_events   -> /day    : the ROI dashboard aggregates by date, so a day's
//                             events sit together. Trade-off is a write hot
//                             spot on today's partition, which is irrelevant at
//                             demo volume but would need revisiting at scale.
resource conversations 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2025-05-01-preview' = {
  parent: database
  name: 'conversations'
  properties: {
    resource: {
      id: 'conversations'
      partitionKey: {
        paths: [
          '/userId'
        ]
        kind: 'Hash'
      }
    }
  }
}

resource usageEvents 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2025-05-01-preview' = {
  parent: database
  name: 'usage_events'
  properties: {
    resource: {
      id: 'usage_events'
      partitionKey: {
        paths: [
          '/day'
        ]
        kind: 'Hash'
      }
    }
  }
  dependsOn: [
    conversations
  ]
}

output accountName string = account.name
output resourceId string = account.id
output endpoint string = account.properties.documentEndpoint
output databaseName string = database.name
