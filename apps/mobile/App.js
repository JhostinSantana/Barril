import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

const STORAGE_API_KEY = 'barril_api_url';
const STORAGE_WAITER_KEY = 'barril_waiter_name';
const STORAGE_DRAFT_ORDER_KEY = 'barril_draft_order';
const ENV_API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';
const TABLE_OPTIONS = Array.from({ length: 16 }, (_, index) => String(index + 1));

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
  return new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
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
  const [waiterDraft, setWaiterDraft] = useState('');
  const [waiterConfigured, setWaiterConfigured] = useState(false);
  const [showWaiterSettings, setShowWaiterSettings] = useState(false);
  const [clientName, setClientName] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [quantities, setQuantities] = useState({});
  const [pendingOrders, setPendingOrders] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [status, setStatus] = useState('');
  const [hasDraft, setHasDraft] = useState(false);

  const selectedCount = useMemo(
    () => Object.values(quantities).reduce((sum, quantity) => sum + Number(quantity || 0), 0),
    [quantities]
  );

  const menuSections = useMemo(() => {
    const grouped = menu.reduce((acc, item) => {
      const category = item.category || 'Sin categoria';
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    }, {});

    return Object.entries(grouped).map(([category, items]) => ({
      category,
      items
    }));
  }, [menu]);

  const editingOrder = useMemo(
    () => pendingOrders.find((order) => order.id === selectedOrderId) ?? null,
    [pendingOrders, selectedOrderId]
  );

  async function loadMenu() {
    try {
      const response = await fetch(`${apiUrl}/api/menu`);
      const data = await response.json();
      setRestaurantName(data.restaurantName);
      setMenu(data.menu);
    } catch (error) {
      setStatus('No se pudo conectar con el servidor.');
    }
  }

  async function loadOpenOrders() {
    try {
      const response = await fetch(`${apiUrl}/api/orders?status=pending`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message ?? 'No se pudieron cargar las comandas.');
      }
      setPendingOrders((Array.isArray(data) ? data : []).filter((order) => order.status === 'pending' || order.status === 'partial'));
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function saveDraftOrder() {
    const draft = { clientName, tableNumber, quantities };
    await AsyncStorage.setItem(STORAGE_DRAFT_ORDER_KEY, JSON.stringify(draft));
    setHasDraft(true);
  }

  async function loadDraftOrder() {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_DRAFT_ORDER_KEY);
      if (stored) {
        const draft = JSON.parse(stored);
        if (draft.clientName || draft.tableNumber || Object.keys(draft.quantities || {}).length > 0) {
          setClientName(draft.clientName || '');
          setTableNumber(draft.tableNumber || '');
          setQuantities(draft.quantities || {});
          setHasDraft(true);
        }
      }
    } catch (error) {
      console.error('Error loading draft:', error);
    }
  }

  async function clearDraftOrder() {
    await AsyncStorage.removeItem(STORAGE_DRAFT_ORDER_KEY);
    setHasDraft(false);
  }

  async function syncWaiterProfile(api) {
    const storedWaiterName = (await AsyncStorage.getItem(STORAGE_WAITER_KEY)) ?? '';
    if (!storedWaiterName.trim()) {
      setWaiterName('');
      setWaiterDraft('');
      setWaiterConfigured(false);
      return;
    }

    try {
      const response = await fetch(`${api}/api/waiters/validate?name=${encodeURIComponent(storedWaiterName)}`);
      const payload = await response.json();

      if (!response.ok || !payload.authorized) {
        await AsyncStorage.removeItem(STORAGE_WAITER_KEY);
        setWaiterName('');
        setWaiterDraft('');
        setWaiterConfigured(false);
        setStatus('El mesero guardado ya no esta autorizado. Registralo de nuevo en la laptop.');
        return;
      }

      const displayName = payload.waiter?.displayName ?? storedWaiterName.trim();
      setWaiterName(displayName);
      setWaiterDraft(displayName);
      setWaiterConfigured(true);
    } catch {
      setWaiterName(storedWaiterName.trim());
      setWaiterDraft(storedWaiterName.trim());
      setWaiterConfigured(true);
    }
  }

  async function saveWaiterProfile() {
    const nextName = waiterDraft.trim().replace(/\s+/g, ' ');
    if (!nextName) {
      setStatus('Escribe el nombre del mesero.');
      return;
    }

    if (!apiUrl) {
      setStatus('La app aun no encuentra la laptop en la red.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${apiUrl}/api/waiters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message ?? 'No se pudo autorizar el mesero.');
      }

      const displayName = payload.displayName ?? nextName;
      await AsyncStorage.setItem(STORAGE_WAITER_KEY, displayName);
      setWaiterName(displayName);
      setWaiterDraft(displayName);
      setWaiterConfigured(true);
      setShowWaiterSettings(false);
      setStatus(`Mesero autorizado: ${displayName}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    async function bootstrap() {
      try {
        setConnecting(true);
        setStatus('Buscando laptop en la red WiFi...');
        const discoveredApi = await discoverServer();
        setApiUrl(discoveredApi);
        await syncWaiterProfile(discoveredApi);
        await loadDraftOrder();
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
    setLoading(true);
    Promise.all([loadMenu(), loadOpenOrders()]).finally(() => setLoading(false));
  }, [apiUrl]);

  useEffect(() => {
    if (clientName || tableNumber || Object.keys(quantities).length > 0) {
      saveDraftOrder();
    }
  }, [clientName, tableNumber]);

  function changeQuantity(id, delta) {
    setQuantities((current) => {
      const next = Math.max(0, Number(current[id] ?? 0) + delta);
      const updated = { ...current, [id]: next === 0 ? undefined : next };
      saveDraftOrder();
      return updated;
    });
  }

  function startOrderEdition(order) {
    const nextQuantities = order.items.reduce((acc, item) => {
      acc[item.menuItemId] = Number(item.quantity) || 0;
      return acc;
    }, {});

    setSelectedOrderId(order.id);
    setClientName(order.clientName ?? '');
    setTableNumber(order.tableNumber ?? '');
    setQuantities(nextQuantities);
    setStatus(`Editando ${order.id}. Los cambios actualizaran la misma cuenta.`);
  }

  function resetDraft() {
    setSelectedOrderId(null);
    setClientName('');
    setTableNumber('');
    setQuantities({});
    clearDraftOrder();
  }

  function openWaiterSettings() {
    setWaiterDraft(waiterName);
    setShowWaiterSettings(true);
  }

  function closeWaiterSettings() {
    setWaiterDraft(waiterName);
    setShowWaiterSettings(false);
  }

  async function submitOrder() {
    const items = Object.entries(quantities)
      .filter(([, quantity]) => Number(quantity) > 0)
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity: Number(quantity) }));

    if (!waiterConfigured || !waiterName.trim()) {
      setStatus('Primero registra y autoriza el mesero de este dispositivo.');
      return;
    }

    if (!clientName.trim() || !tableNumber.trim() || items.length === 0) {
      setStatus('Completa cliente, mesa y al menos un producto.');
      return;
    }

    if (!TABLE_OPTIONS.includes(tableNumber)) {
      setStatus('Selecciona una mesa valida entre 1 y 16.');
      return;
    }

    if (!apiUrl) {
      setStatus('La app aun no encuentra la laptop en la red.');
      return;
    }

    setSubmitting(true);
    setStatus(selectedOrderId ? 'Actualizando comanda...' : 'Enviando comanda...');

    try {
      const response = await fetch(
        selectedOrderId ? `${apiUrl}/api/orders/${selectedOrderId}` : `${apiUrl}/api/orders`,
        {
          method: selectedOrderId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ waiterName, clientName, tableNumber, items })
        }
      );

      const payload = await response.json();

      if (!response.ok) {
        if (response.status === 403) {
          await AsyncStorage.removeItem(STORAGE_WAITER_KEY);
          setWaiterName('');
          setWaiterDraft('');
          setWaiterConfigured(false);
        }
        throw new Error(payload.message ?? 'No se pudo enviar la comanda.');
      }

      const wasEditing = Boolean(selectedOrderId);
      resetDraft();
      await loadOpenOrders();
      setStatus(
        wasEditing
          ? 'Comanda actualizada en la laptop.'
          : payload.printer?.printed
            ? 'Comanda enviada y ticket impreso.'
            : 'Comanda enviada.'
      );
      Alert.alert(
        wasEditing ? 'Comanda actualizada' : 'Pedido enviado',
        wasEditing
          ? 'La cuenta se actualizo sin crear una nueva.'
          : payload.printer?.printed
            ? 'Ticket de cocina impreso.'
            : 'Pedido recibido por la caja.'
      );
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
          <Text style={styles.sectionTitle}>Mesero del dispositivo</Text>
          <Text style={styles.serverBadge}>Este nombre se guarda una sola vez y viaja con cada comanda.</Text>
          {waiterConfigured ? (
            <View style={styles.waiterBanner}>
              <Text style={styles.waiterBannerText}>Conectado como {waiterName}</Text>
              <Pressable style={styles.waiterChangeButton} onPress={openWaiterSettings}>
                <Text style={styles.waiterChangeButtonText}>Ajustes</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                value={waiterDraft}
                onChangeText={setWaiterDraft}
                placeholder="Nombre del mesero"
                placeholderTextColor="#8c7d6f"
                style={styles.input}
              />
              <Pressable style={styles.primaryButton} onPress={saveWaiterProfile} disabled={submitting}>
                <Text style={styles.primaryButtonText}>{submitting ? 'Guardando...' : 'Autorizar mesero'}</Text>
              </Pressable>
            </>
          )}
          {showWaiterSettings ? (
            <View style={styles.waiterSettingsCard}>
              <Text style={styles.waiterSettingsTitle}>Ajustes del mesero</Text>
              <TextInput
                value={waiterDraft}
                onChangeText={setWaiterDraft}
                placeholder="Nuevo nombre del mesero"
                placeholderTextColor="#8c7d6f"
                style={styles.input}
              />
              <View style={styles.waiterSettingsActions}>
                <Pressable style={styles.primaryButton} onPress={saveWaiterProfile} disabled={submitting}>
                  <Text style={styles.primaryButtonText}>{submitting ? 'Guardando...' : 'Guardar cambio'}</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={closeWaiterSettings}>
                  <Text style={styles.secondaryButtonText}>Cerrar</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>Datos de la comanda</Text>
          <Text style={styles.serverBadge}>Servidor: {apiUrl || 'Detectando laptop...'}</Text>
          {hasDraft && !editingOrder ? (
            <View style={styles.draftBanner}>
              <View>
                <Text style={styles.draftBannerTitle}>📝 Comanda en progreso</Text>
                <Text style={styles.draftBannerText}>Tienes una comanda sin enviar.</Text>
              </View>
              <Pressable style={styles.discardDraftButton} onPress={resetDraft}>
                <Text style={styles.discardDraftButtonText}>Descartar</Text>
              </Pressable>
            </View>
          ) : null}
          {editingOrder ? (
            <View style={styles.editBanner}>
              <Text style={styles.editBannerText}>Editando {editingOrder.id}</Text>
              <Pressable style={styles.cancelEditButton} onPress={resetDraft}>
                <Text style={styles.cancelEditButtonText}>Cancelar</Text>
              </Pressable>
            </View>
          ) : null}
          <Text style={styles.waiterHint}>Mesero activo: {waiterName || 'sin autorizar'}</Text>
          <TextInput
            value={clientName}
            onChangeText={setClientName}
            placeholder="Nombre del cliente"
            placeholderTextColor="#8c7d6f"
            style={styles.input}
          />
          <TextInput
            value={tableNumber}
            editable={false}
            placeholder="Selecciona mesa"
            placeholderTextColor="#8c7d6f"
            style={styles.input}
          />
          <View style={styles.tableGrid}>
            {TABLE_OPTIONS.map((table) => (
              <Pressable
                key={table}
                style={[styles.tableChip, tableNumber === table ? styles.tableChipActive : null]}
                onPress={() => setTableNumber(table)}
              >
                <Text style={[styles.tableChipText, tableNumber === table ? styles.tableChipTextActive : null]}>
                  Mesa {table}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.formCard}>
          <View style={styles.openOrdersHeader}>
            <Text style={styles.sectionTitle}>Comandas abiertas</Text>
            <Pressable onPress={loadOpenOrders}>
              <Text style={styles.refreshOrdersText}>Actualizar</Text>
            </Pressable>
          </View>
          {pendingOrders.length === 0 ? (
            <Text style={styles.serverBadge}>No hay comandas pendientes para editar.</Text>
          ) : (
            <View style={styles.openOrdersGrid}>
              {pendingOrders.map((order) => (
                <Pressable
                  key={order.id}
                  style={[styles.openOrderCard, selectedOrderId === order.id ? styles.openOrderCardActive : null]}
                  onPress={() => startOrderEdition(order)}
                >
                  <Text style={styles.openOrderTitle}>{order.clientName}</Text>
                  <Text style={styles.openOrderMeta}>{order.id} · Mesa {order.tableNumber}</Text>
                  <Text style={styles.openOrderMeta}>{order.items.length} items</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.menuHeader}>
          <Text style={styles.sectionTitle}>Menu por secciones</Text>
          <Text style={styles.counter}>{selectedCount} items</Text>
        </View>

        {loading || connecting ? <ActivityIndicator color="#1f8f73" /> : null}

        {menuSections.map((section) => (
          <View key={section.category} style={styles.sectionCard}>
            <Text style={styles.sectionCategory}>{section.category}</Text>
            {section.items.map((item) => (
              <View key={item.id} style={styles.menuCard}>
                <View style={styles.menuMeta}>
                  <Text style={styles.dishName}>{item.name}</Text>
                  <Text style={styles.price}>{formatCurrency(Number(item.price) || 0)}</Text>
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
            ))}
          </View>
        ))}

        <View style={styles.actionCard}>
          <View>
            <Text style={styles.actionLabel}>Estado</Text>
            <Text style={styles.statusText}>{status || 'Lista para enviar'}</Text>
          </View>
          <Pressable style={styles.primaryButton} onPress={submitOrder} disabled={submitting}>
            <Text style={styles.primaryButtonText}>
              {submitting ? 'Guardando...' : selectedOrderId ? 'Guardar cambios de comanda' : 'Enviar comanda'}
            </Text>
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
  waiterBanner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cfe8df',
    backgroundColor: '#eefaf5',
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10
  },
  waiterBannerText: {
    flex: 1,
    color: '#145f4b',
    fontWeight: '800'
  },
  waiterChangeButton: {
    backgroundColor: '#2f2319',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  waiterChangeButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800'
  },
  waiterSettingsCard: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e6d6c4',
    backgroundColor: '#fffdf9',
    padding: 12,
    gap: 10
  },
  waiterSettingsTitle: {
    color: '#2c221c',
    fontWeight: '800',
    fontSize: 14
  },
  waiterSettingsActions: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap'
  },
  secondaryButton: {
    backgroundColor: '#f2e7db',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center'
  },
  secondaryButtonText: {
    color: '#2f2319',
    fontSize: 16,
    fontWeight: '800'
  },
  waiterHint: {
    color: '#6f5e4d',
    fontWeight: '700',
    paddingVertical: 2
  },
  editBanner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f3c89e',
    backgroundColor: '#fff2e5',
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10
  },
  editBannerText: {
    color: '#8b4d1d',
    fontWeight: '800',
    flex: 1
  },
  cancelEditButton: {
    backgroundColor: '#2f2319',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  cancelEditButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12
  },
  draftBanner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c9d8e6',
    backgroundColor: '#eef3f9',
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10
  },
  draftBannerTitle: {
    color: '#0d4a8f',
    fontWeight: '800',
    fontSize: 14
  },
  draftBannerText: {
    color: '#2c5aa0',
    fontWeight: '600',
    fontSize: 12,
    marginTop: 2
  },
  discardDraftButton: {
    backgroundColor: '#d32f2f',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  discardDraftButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12
  },
  openOrdersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  refreshOrdersText: {
    color: '#1f8f73',
    fontWeight: '800'
  },
  openOrdersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  openOrderCard: {
    borderWidth: 1,
    borderColor: '#dcc8b3',
    borderRadius: 12,
    padding: 10,
    backgroundColor: '#fff',
    minWidth: '48%'
  },
  openOrderCardActive: {
    borderColor: '#f08a24',
    backgroundColor: '#fff3e6'
  },
  openOrderTitle: {
    color: '#231a15',
    fontWeight: '800'
  },
  openOrderMeta: {
    marginTop: 2,
    color: '#6f5e4d',
    fontSize: 12,
    fontWeight: '700'
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  tableGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  tableChip: {
    borderWidth: 1,
    borderColor: '#dcc8b3',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff'
  },
  tableChipActive: {
    backgroundColor: '#2f2319',
    borderColor: '#2f2319'
  },
  tableChipText: {
    color: '#2f2319',
    fontWeight: '700',
    fontSize: 12
  },
  tableChipTextActive: {
    color: '#fff'
  },
  counter: {
    color: '#1f8f73',
    fontWeight: '800'
  },
  sectionCard: {
    gap: 8,
    marginBottom: 6
  },
  sectionCategory: {
    color: '#8f6d45',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 12,
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
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    alignItems: 'flex-start'
  },
  dishName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#231a15'
  },
  price: {
    color: '#1f8f73',
    fontWeight: '800',
    fontSize: 14
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
