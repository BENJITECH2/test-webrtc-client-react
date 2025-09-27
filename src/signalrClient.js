// Utility for connecting to SignalR
import * as signalR from '@microsoft/signalr';

export function createSignalRConnection(signalRUrl, token) {
  const connection = new signalR.HubConnectionBuilder()
    .withUrl(signalRUrl, { 
      accessTokenFactory: () => token // Pass JWT token for authentication
    })
    .withAutomaticReconnect()
    .build();

  return connection;
}
