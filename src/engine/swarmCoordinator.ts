// src/engine/swarmCoordinator.ts
import * as dgram from 'dgram';
import { EventEmitter } from 'events';

export interface SwarmNode {
  nodeId: string;
  host: string;
  port: number;
  availableCapacity: number;
  lastSeen: number;
}

export class RyanAISwarmCoordinator extends EventEmitter {
  private static instance: RyanAISwarmCoordinator;
  private udpPort = 41234;
  private socket = dgram.createSocket('udp4');
  private activePeers = new Map<string, SwarmNode>();
  private nodeId = `node-${Math.random().toString(36).substring(2, 9)}`;
  private broadcastInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.setupSocket();
  }

  public static getInstance(): RyanAISwarmCoordinator {
    if (!this.instance) {
      this.instance = new RyanAISwarmCoordinator();
    }
    return this.instance;
  }

  /**
   * Listens for peer beacon broadcasts on the mesh UDP socket, updating known peers and
   * silently discarding malformed packets
   */
  private setupSocket() {
    this.socket.on('message', (msg, rinfo) => {
      try {
        const payload = JSON.parse(msg.toString());
        if (payload.nodeId && payload.nodeId !== this.nodeId) {
          this.activePeers.set(payload.nodeId, {
            nodeId: payload.nodeId,
            host: rinfo.address,
            port: payload.port || 3000,
            availableCapacity: payload.capacity || 100,
            lastSeen: Date.now()
          });
          this.emit('peer_updated', payload.nodeId);
        }
      } catch {
        // Ignore malformed broadcast packets
      }
    });

    this.socket.bind(this.udpPort, () => {
      this.socket.setBroadcast(true);
      console.log(`[Swarm Mesh] Node [${this.nodeId}] listening for peer beacons on UDP port ${this.udpPort}`);
    });
  }

  /**
   * Starts broadcasting presence to the local network mesh
   */
  public startMeshBroadcast(gatewayPort = 3000) {
    if (this.broadcastInterval) return;

    this.broadcastInterval = setInterval(() => {
      const message = JSON.stringify({
        nodeId: this.nodeId,
        port: gatewayPort,
        capacity: 100,
        timestamp: Date.now()
      });

      // Broadcast to local subnet
      this.socket.send(message, 0, message.length, this.udpPort, '255.255.255.255', (err) => {
        if (err) {
          // Fallback or silent suppression for restricted network environments
        }
      });

      // Prune dead peers (unseen for > 15 seconds)
      const now = Date.now();
      for (const [id, peer] of this.activePeers.entries()) {
        if (now - peer.lastSeen > 15000) {
          this.activePeers.delete(id);
          console.log(`[Swarm Mesh] Peer node timed out and dropped: ${id}`);
        }
      }
    }, 5000) as unknown as NodeJS.Timeout;

    console.log("[Swarm Mesh] Active mesh heartbeat initialized.");
  }

  /**
   * Retrieves all currently connected peer nodes in the cluster mesh
   */
  public getConnectedPeers(): SwarmNode[] {
    return Array.from(this.activePeers.values());
  }

  /**
   * Gracefully shuts down the swarm socket and heartbeat
   */
  public shutdown() {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
    }
    this.socket.close();
    console.log("[Swarm Mesh] Coordinator shut down.");
  }
}