import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

const STORAGE_API_KEY = 'barril_api_url';
const ENV_API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

async function fetchWithTimeout(url, options = {}, timeoutMs = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getLanPrefix(ipAddress) {
  const parts = ipAddress?.split('.') ?? [];
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

function buildCandidates(localIp, gatewayIp) {
  const candidates = [];

  if (ENV_API_URL) {
    candidates.push(ENV_API_URL);
  }

  const pushHost = (host) => {
    if (!host) return;
    candidates.push(`http://${host}:4000`);
  };

  pushHost(gatewayIp);

  const prefix = getLanPrefix(localIp);
  if (prefix) {
    [2, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240].forEach((suffix) => {
      if (`${prefix}.${suffix}` !== localIp) {
        pushHost(`${prefix}.${suffix}`);
      }
    });
  }

  return [...new Set(candidates)];
}

async function isBarrilServer(apiUrl) {
  try {
    const response = await fetchWithTimeout(`${apiUrl}/health`);
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.service === 'asados-en-el-barril-server';
  } catch {
    return false;
  }
}

async function discoverServer() {
  const storedApi = await AsyncStorage.getItem(STORAGE_API_KEY);
  if (storedApi && (await isBarrilServer(storedApi))) {
    return storedApi;
  }

  const localIp = await Network.getIpAddressAsync().catch(() => '');
  const gatewayIp = await Network.getGatewayIPAddressAsync().catch(() => '');
  const candidates = buildCandidates(localIp, gatewayIp);

  for (const candidate of candidates) {
    if (await isBarrilServer(candidate)) {
      await AsyncStorage.setItem(STORAGE_API_KEY, candidate);
      return candidate;
    }
  }

  throw new Error('No se encontro la laptop en esta red WiFi.');
}

function formatCurrency(value) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(value ?? 0);
}

export default function App() {
  const [restaurantName, setRestaurantName] = useState('Asados en el Barril');
  const [menu, setMenu] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [apiUrl, setApiUrl] = useState('');
  const [connecting, setConnecting] = useState(true);
  const [waiterName, setWaiterName] = useState('');
  const [clientName, setClientName] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [quantities, setQuantities] = useState({});
  const [status, setStatus] = useState('');

  const selectedCount = useMemo(
    () => Object.values(quantities).reduce((sum, quantity) => sum + Number(quantity || 0), 0),
    [quantities]
  );

  async function loadMenu() {
    try {
      const response = await fetch(`${apiUrl}/api/menu`);
      const data = await response.json();
      setRestaurantName(data.restaurantName);
      setMenu(data.menu);
    } catch (error) {
      setStatus('No se pudo conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function bootstrap() {
      try {
        setConnecting(true);
        setStatus('Buscando laptop en la red WiFi...');
        const discoveredApi = await discoverServer();
        setApiUrl(discoveredApi);
        setStatus(`Conectado a ${discoveredApi}`);
      } catch (error) {
        setStatus(error.message);
      } finally {
        setConnecting(false);
      }
    }

    bootstrap();
  }, []);

  useEffect(() => {
    if (!apiUrl) return;
    loadMenu();
  }, [apiUrl]);

  function changeQuantity(id, delta) {
    setQuantities((current) => {
      const next = Math.max(0, Number(current[id] ?? 0) + delta);
      return { ...current, [id]: next === 0 ? undefined : next };
    });
  }

  async function submitOrder() {
    const items = Object.entries(quantities)
      .filter(([, quantity]) => Number(quantity) > 0)
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity: Number(quantity) }));

    if (!waiterName.trim() || !clientName.trim() || !tableNumber.trim() || items.length === 0) {
      setStatus('Completa mesero, cliente, mesa y al menos un plato.');
      return;
    }

    if (!apiUrl) {
      setStatus('La app aun no encuentra la laptop en la red.');
      return;
    }

    setSubmitting(true);
    setStatus('Enviando comanda...');

    try {
      const response = await fetch(`${apiUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waiterName, clientName, tableNumber, items })
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message ?? 'No se pudo enviar la comanda.');
      }

      setClientName('');
      setTableNumber('');
      setWaiterName('');
      setQuantities({});
      setStatus(
        payload.printer?.printed ? 'Comanda enviada y ticket impreso.' : 'Comanda enviada.'
      );
      Alert.alert('Pedido enviado', payload.printer?.printed ? 'Ticket de cocina impreso.' : 'Pedido recibido por la caja.');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>Panel movil de meseros</Text>
          <Text style={styles.heroTitle}>{restaurantName}</Text>
          <Text style={styles.heroSubtitle}>Toma pedidos sin precios y los envia en tiempo real a la caja.</Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>Datos de la comanda</Text>
          <Text style={styles.serverBadge}>Servidor: {apiUrl || 'Detectando laptop...'}</Text>
          <TextInput
            value={waiterName}
            onChangeText={setWaiterName}
            placeholder="Nombre del mesero"
            placeholderTextColor="#8c7d6f"
            style={styles.input}
          />
          <TextInput
            value={clientName}
            onChangeText={setClientName}
            placeholder="Nombre del cliente"
            placeholderTextColor="#8c7d6f"
            style={styles.input}
          />
          <TextInput
            value={tableNumber}
            onChangeText={setTableNumber}
            placeholder="Mesa"
            placeholderTextColor="#8c7d6f"
            style={styles.input}
            keyboardType="numeric"
          />
        </View>

        <View style={styles.menuHeader}>
          <Text style={styles.sectionTitle}>Menu sin precios</Text>
          <Text style={styles.counter}>{selectedCount} items</Text>
        </View>

        {loading || connecting ? <ActivityIndicator color="#1f8f73" /> : null}

        <FlatList
          data={menu}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <View style={styles.menuCard}>
              <View style={styles.menuMeta}>
                <Text style={styles.category}>{item.category}</Text>
                <Text style={styles.dishName}>{item.name}</Text>
              </View>

              <View style={styles.quantityRow}>
                <Pressable style={styles.quantityButton} onPress={() => changeQuantity(item.id, -1)}>
                  <Text style={styles.quantityButtonText}>-</Text>
                </Pressable>
                <Text style={styles.quantityValue}>{quantities[item.id] ?? 0}</Text>
                <Pressable style={styles.quantityButton} onPress={() => changeQuantity(item.id, 1)}>
                  <Text style={styles.quantityButtonText}>+</Text>
                </Pressable>
              </View>
            </View>
          )}
        />

        <View style={styles.actionCard}>
          <View>
            <Text style={styles.actionLabel}>Estado</Text>
            <Text style={styles.statusText}>{status || 'Lista para enviar'}</Text>
          </View>
          <Pressable style={styles.primaryButton} onPress={submitOrder} disabled={submitting}>
            <Text style={styles.primaryButtonText}>{submitting ? 'Enviando...' : 'Enviar comanda'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5efe8'
  },
  container: {
    padding: 16,
    gap: 14
  },
  hero: {
    backgroundColor: '#2f2319',
    borderRadius: 24,
    padding: 18
  },
  heroEyebrow: {
    color: '#f8d9b8',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    fontSize: 12,
    marginBottom: 8
  },
  heroTitle: {
    color: '#fff7ef',
    fontSize: 30,
    fontWeight: '800'
  },
  heroSubtitle: {
    marginTop: 8,
    color: '#f1ddcc',
    lineHeight: 20
  },
  formCard: {
    backgroundColor: '#fffaf4',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e8d8c6',
    gap: 10
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#241c16'
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dcc8b3',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#241c16'
  },
  serverBadge: {
    color: '#6f5e4d',
    fontSize: 12,
    fontWeight: '700'
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  counter: {
    color: '#1f8f73',
    fontWeight: '800'
  },
  menuCard: {
    backgroundColor: '#fffdf9',
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eadaca'
  },
  menuMeta: {
    marginBottom: 10
  },
  category: {
    color: '#8f6d45',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 11,
    fontWeight: '700'
  },
  dishName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#231a15',
    marginTop: 4
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12
  },
  quantityButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1f8f73',
    alignItems: 'center',
    justifyContent: 'center'
  },
  quantityButtonText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800'
  },
  quantityValue: {
    minWidth: 32,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: '#231a15'
  },
  actionCard: {
    backgroundColor: '#fffaf4',
    borderWidth: 1,
    borderColor: '#e8d8c6',
    borderRadius: 20,
    padding: 14,
    marginTop: 6,
    gap: 12
  },
  actionLabel: {
    color: '#8b7a68',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4
  },
  statusText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2c221c'
  },
  primaryButton: {
    backgroundColor: '#f08a24',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center'
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800'
  }
});
