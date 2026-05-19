import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  FlatList,
  type ListRenderItemInfo,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {io, Socket} from 'socket.io-client';

type KitchenStatus = 'pendiente' | 'en_preparacion' | 'completado';

type PedidoComment = {
  text: string;
  createdAt: string;
  author?: string;
  kind?: string;
};

type EditChangeType = 'added' | 'removed' | 'quantity-up' | 'quantity-down';

type EditChange = {
  menuItemId: string;
  nombre: string;
  type: EditChangeType;
  previousQuantity: number;
  quantity: number;
};

type PedidoItem = {
  id: string;
  nombre: string;
  cantidad: number;
  cantidadPreparada?: number;
  cantidadPendiente?: number;
  notas?: string;
  editado?: boolean;
  preparado?: boolean;
};

type Pedido = {
  id: string;
  numeroMesa: string;
  nombreCliente: string;
  items: PedidoItem[];
  comments: PedidoComment[];
  horaRecibido: string;
  createdAt: string;
  editedAt: string | null;
  editSummary: EditChange[];
  kitchenFulfilledItems: Array<{menuItemId: string; nombre: string; quantity: number}>;
  estado: KitchenStatus;
};

type PedidoVista = Pedido & {
  completadoEn?: number;
};

const STORAGE_API_KEY = 'barril_api_url';
const STORAGE_SOUND_KEY = 'cocina_sound_on';
const STORAGE_COMPLETADOS_KEY = 'cocina_completados_hoy';
const STORAGE_COMPLETADOS_DATE_KEY = 'cocina_completados_fecha';
const EMPTY_STATUS = 'Sin comandas activas';

function pad2(value: number) {
  return value < 10 ? `0${value}` : String(value);
}

function getTodayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatHour12(date: Date, withSeconds = false) {
  const hours = date.getHours();
  const minutes = pad2(date.getMinutes());
  const suffix = hours >= 12 ? 'p. m.' : 'a. m.';
  const hour12 = hours % 12 || 12;
  if (withSeconds) {
    return `${hour12}:${minutes}:${pad2(date.getSeconds())} ${suffix}`;
  }
  return `${hour12}:${minutes} ${suffix}`;
}

function formatCommentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}, ${formatHour12(date)}`;
}

const statusMeta: Record<KitchenStatus, {label: string; color: string; accent: string}> = {
  pendiente: {label: 'Pendiente', color: '#f59e0b', accent: '#fff7ed'},
  en_preparacion: {label: 'En preparación', color: '#0284c7', accent: '#eff6ff'},
  completado: {label: 'Completado', color: '#16a34a', accent: '#f0fdf4'},
};

function getDefaultApiBase() {
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:4000';
  }

  return 'http://localhost:4000';
}

function normalizeKitchenStatus(value: unknown): KitchenStatus {
  if (value === 'en_preparacion' || value === 'completado') {
    return value;
  }
  return 'pendiente';
}

function normalizeTextId(value: unknown, fallback: string) {
  const normalized = value === null || value === undefined ? '' : String(value).trim();
  return normalized || fallback;
}

function normalizeComments(order: any): PedidoComment[] {
  if (Array.isArray(order?.comments)) {
    return order.comments
      .map((comment: any) => ({
        text: String(comment?.text ?? comment?.comment ?? '').trim(),
        createdAt: String(comment?.createdAt ?? new Date().toISOString()),
        author: String(comment?.author ?? '').trim() || undefined,
        kind: String(comment?.kind ?? '').trim() || undefined,
      }))
      .filter((comment: PedidoComment) => Boolean(comment.text));
  }

  const singleComment = String(order?.comment ?? '').trim();
  if (!singleComment) {
    return [];
  }

  return [
    {
      text: singleComment,
      createdAt: String(order?.createdAt ?? new Date().toISOString()),
      author: String(order?.waiterName ?? order?.author ?? '').trim() || undefined,
      kind: 'initial',
    },
  ];
}

function formatTimeNow(date: Date) {
  return formatHour12(date, true);
}

function formatDateNow(date: Date) {
  const weekdays = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${weekdays[date.getDay()]}, ${pad2(date.getDate())} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function normalizeEditSummary(order: any): EditChange[] {
  if (!Array.isArray(order?.editSummary)) {
    return [];
  }

  return order.editSummary
    .map((change: any) => ({
      menuItemId: String(change?.menuItemId ?? ''),
      nombre: String(change?.name ?? change?.nombre ?? 'Item'),
      type: (['added', 'removed', 'quantity-up', 'quantity-down'].includes(change?.type)
        ? change.type
        : 'quantity-up') as EditChangeType,
      previousQuantity: Number(change?.previousQuantity ?? 0),
      quantity: Number(change?.quantity ?? 0),
    }))
    .filter((change: EditChange) => Boolean(change.nombre && change.menuItemId));
}

function getEditChangeLabel(change: EditChange) {
  if (change.type === 'added') {
    return `Agregado · cantidad ${change.quantity}`;
  }
  if (change.type === 'removed') {
    return `Eliminado · tenía ${change.previousQuantity}`;
  }
  if (change.type === 'quantity-up') {
    return `Subió de ${change.previousQuantity} a ${change.quantity}`;
  }
  if (change.type === 'quantity-down') {
    return `Bajó de ${change.previousQuantity} a ${change.quantity}`;
  }
  return 'Modificado';
}

function pedidoFueModificado(pedido: Pick<Pedido, 'editSummary'>) {
  return pedido.editSummary.length > 0;
}

function normalizeKitchenFulfilledItems(order: any) {
  const raw = order?.kitchenFulfilledItems ?? order?.kitchen_fulfilled_items;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item: any) => ({
      menuItemId: String(item?.menuItemId ?? ''),
      nombre: String(item?.name ?? item?.nombre ?? 'Item'),
      quantity: Number(item?.quantity ?? 0),
    }))
    .filter(item => item.menuItemId.length > 0);
}

function pedidoTieneHistorialPreparado(pedido: Pick<Pedido, 'items'>) {
  return pedido.items.some(item => (item.cantidadPreparada ?? 0) > 0);
}

function pedidoTieneTrabajoPendiente(pedido: Pick<Pedido, 'estado' | 'items'>) {
  if (pedido.estado !== 'completado') {
    return true;
  }

  return pedido.items.some(item => (item.cantidadPendiente ?? 0) > 0);
}

function pedidoEsReapertura(pedido: Pick<Pedido, 'items'>) {
  return pedido.items.some(item => (item.cantidadPreparada ?? 0) > 0 && (item.cantidadPendiente ?? 0) > 0);
}

/** Solo entra a la cola horizontal lo que cocina aún debe hacer. */
function pedidoVisibleEnCocina(pedido: PedidoVista) {
  return pedidoTieneTrabajoPendiente(pedido);
}

function upsertPedidoEnCola(current: PedidoVista[], mapped: PedidoVista): PedidoVista[] {
  if (!pedidoVisibleEnCocina(mapped)) {
    return current.filter(pedido => pedido.id !== mapped.id);
  }

  return mergeKitchenOrderInList(current, mapped);
}

function sortKitchenQueue(orders: PedidoVista[]): PedidoVista[] {
  return [...orders].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();

    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return String(left.id).localeCompare(String(right.id));
  });
}

function isSocketOrderPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function mergeKitchenOrderInList(current: PedidoVista[], mapped: PedidoVista): PedidoVista[] {
  const index = current.findIndex(pedido => pedido.id === mapped.id);
  if (index === -1) {
    return sortKitchenQueue([...current, mapped]);
  }

  const next = current.slice();
  next[index] = mapped;
  return sortKitchenQueue(next);
}

function mapServerOrderToKitchen(order: any): PedidoVista {
  const editSummary = normalizeEditSummary(order);
  const kitchenFulfilledItems = normalizeKitchenFulfilledItems(order);
  const fulfilledMap = new Map(
    kitchenFulfilledItems.map(item => [String(item.menuItemId), item.quantity]),
  );
  const editedMenuIds = new Set(
    editSummary.filter(change => change.type !== 'removed').map(change => String(change.menuItemId)),
  );
  const items = Array.isArray(order?.items)
    ? order.items.map((item: any, index: number) => {
        const menuItemId = String(item.menuItemId ?? `item-${index}`);
        const cantidad = Number(item.quantity ?? item.cantidad ?? 1);
        const cantidadPreparada = Math.min(fulfilledMap.get(menuItemId) ?? 0, cantidad);
        const cantidadPendiente = Math.max(0, cantidad - cantidadPreparada);
        return {
          id: menuItemId,
          nombre: String(item.name ?? item.nombre ?? 'Item'),
          cantidad,
          cantidadPreparada,
          cantidadPendiente,
          notas: String(item.notes ?? item.notas ?? ''),
          editado: editedMenuIds.has(menuItemId) && cantidadPendiente > 0,
          preparado: cantidad > 0 && cantidadPendiente <= 0,
        };
      })
    : [];
  const comments = normalizeComments(order);
  const createdAt = String(order?.createdAt ?? new Date().toISOString());
  const editedAt = order?.editedAt ? String(order.editedAt) : null;

  return {
    id: normalizeTextId(order?.id ?? order?.orderId ?? order?._id, `pedido-${Date.now()}`),
    numeroMesa: normalizeTextId(order?.tableNumber ?? order?.numeroMesa, '0'),
    nombreCliente: String(order?.clientName ?? order?.nombreCliente ?? 'Cliente'),
    items,
    comments,
    createdAt,
    editedAt,
    editSummary,
    kitchenFulfilledItems,
    horaRecibido: order?.createdAt ? formatHour12(new Date(order.createdAt)) : 'Ahora',
    estado: normalizeKitchenStatus(order?.kitchenStatus ?? order?.estado ?? 'pendiente'),
  };
}

export default function App(): React.JSX.Element {
  const {width: windowWidth} = useWindowDimensions();
  const isMobile = windowWidth < 600;
  const cardWidth = isMobile
    ? Math.min(320, Math.max(280, Math.round(windowWidth * 0.88)))
    : Math.min(340, Math.max(280, windowWidth * 0.34));
  const cardStride = cardWidth + 12;

  const [pedidos, setPedidos] = useState<PedidoVista[]>([]);
  const [pedidoActivo, setPedidoActivo] = useState<PedidoVista | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Conectando con la laptop...');
  const [apiBase, setApiBase] = useState(getDefaultApiBase());
  const [connDraft, setConnDraft] = useState(getDefaultApiBase());
  const [showConnModal, setShowConnModal] = useState(true);
  const [completadosHoy, setCompletadosHoy] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [nowUpdating, setNowUpdating] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const timeoutRefs = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const loadGenerationRef = useRef(0);
  const soundOnRef = useRef(soundOn);
  const syncDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadOrdersRef = useRef<(options?: {silent?: boolean; statusMessage?: string}) => Promise<void>>(
    async () => {},
  );

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const [savedUrl, savedSound, savedCompletados, savedCompletadosDate] = await Promise.all([
          AsyncStorage.getItem(STORAGE_API_KEY),
          AsyncStorage.getItem(STORAGE_SOUND_KEY),
          AsyncStorage.getItem(STORAGE_COMPLETADOS_KEY),
          AsyncStorage.getItem(STORAGE_COMPLETADOS_DATE_KEY),
        ]);

        if (!mounted) {
          return;
        }

        if (savedUrl?.trim()) {
          setApiBase(savedUrl.trim());
          setConnDraft(savedUrl.trim());
          setShowConnModal(false);
        }

        if (savedSound !== null) {
          setSoundOn(savedSound !== 'false');
        }

        if (savedCompletadosDate === getTodayKey() && savedCompletados) {
          const parsed = Number.parseInt(savedCompletados, 10);
          if (!Number.isNaN(parsed) && parsed >= 0) {
            setCompletadosHoy(parsed);
          }
        }
      } catch (error) {
        console.warn('No se pudo restaurar configuración', error);
      }
    };

    bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const pendingTimeouts = timeoutRefs.current;

    return () => {
      pendingTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
      socketRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    soundOnRef.current = soundOn;
    AsyncStorage.setItem(STORAGE_SOUND_KEY, soundOn ? 'true' : 'false').catch(() => {});
  }, [soundOn]);

  const reconnectSocket = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) {
      return;
    }

    if (socket.connected) {
      loadOrdersRef.current({silent: true, statusMessage: 'Sincronizando comandas...'}).catch(() => {});
      return;
    }

    if (socket.active) {
      return;
    }

    socket.connect();
  }, []);

  useEffect(() => {
    const socket = io(apiBase, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      timeout: 20000,
    });

    socketRef.current = socket;

    const loadOrders = async (options?: {silent?: boolean; statusMessage?: string}) => {
      const generation = ++loadGenerationRef.current;
      const silent = options?.silent ?? false;

      if (!silent) {
        setLoading(true);
      }

      try {
        let response = await fetch(`${apiBase}/api/orders/kitchen`);
        if (response.status === 404) {
          response = await fetch(`${apiBase}/api/orders?status=pending`);
        }

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message ?? 'No se pudieron cargar las comandas.');
        }

        if (generation !== loadGenerationRef.current) {
          return;
        }

        const mapped = sortKitchenQueue((Array.isArray(data) ? data : []).map(mapServerOrderToKitchen));
        setPedidos(mapped.filter(pedido => pedidoVisibleEnCocina(pedido)));
        setStatus(options?.statusMessage ?? (mapped.length ? 'Comandas sincronizadas con la laptop.' : EMPTY_STATUS));
      } catch (error) {
        if (generation !== loadGenerationRef.current) {
          return;
        }

        const message = error instanceof Error ? error.message : 'No se pudo conectar con el servidor.';
        setStatus(message);
      } finally {
        if (!silent && generation === loadGenerationRef.current) {
          setLoading(false);
        }
      }
    };

    loadOrdersRef.current = loadOrders;

    const notifyNewOrder = () => {
      if (soundOnRef.current) {
        try {
          Vibration.vibrate(250);
        } catch {
          // Ignore vibration failures on devices that do not support it reliably.
        }
      }

      setStatus('Nueva comanda recibida desde el móvil.');
    };

    const syncOrders = (statusMessage?: string) => {
      if (syncDebounceRef.current) {
        clearTimeout(syncDebounceRef.current);
      }

      syncDebounceRef.current = setTimeout(() => {
        syncDebounceRef.current = null;
        loadOrders({silent: true, statusMessage}).catch(() => {});
      }, 400);
    };

    const applyOrderFromSocket = (rawOrder: unknown) => {
      if (!isSocketOrderPayload(rawOrder)) {
        syncOrders();
        return;
      }

      const mapped = mapServerOrderToKitchen(rawOrder);
      if (String(rawOrder.status ?? '') === 'paid') {
        setPedidos(current => current.filter(pedido => pedido.id !== mapped.id));
        return;
      }

      setPedidos(current => upsertPedidoEnCola(current, mapped));
    };

    const onOrderNew = (rawOrder: unknown) => {
      notifyNewOrder();
      applyOrderFromSocket(rawOrder);
    };

    const onOrdersChanged = (rawOrder: unknown) => {
      if (isSocketOrderPayload(rawOrder)) {
        const mapped = mapServerOrderToKitchen(rawOrder);
        if (pedidoTieneHistorialPreparado(mapped)) {
          if (soundOnRef.current) {
            try {
              Vibration.vibrate(250);
            } catch {
              // Ignore vibration failures on devices that do not support it reliably.
            }
          }
          setStatus('Comanda ampliada: en gris ya está listo, preparar lo resaltado.');
        }
      }

      applyOrderFromSocket(rawOrder);
    };

    const onConnect = () => {
      setSocketConnected(true);
      loadOrders({silent: true}).catch(() => {});
    };

    const onDisconnect = () => {
      setSocketConnected(false);
      setStatus('Sin conexión con el servidor. Reconectando automáticamente...');
    };

    const onReconnect = () => {
      setSocketConnected(true);
      setStatus('Conexión restaurada. Sincronizando comandas...');
      loadOrders({silent: true, statusMessage: 'Conexión restaurada. Sincronizando comandas...'}).catch(() => {});
    };

    const onConnectError = () => {
      setSocketConnected(false);
    };

    socket.connect();
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('reconnect', onReconnect);
    socket.on('connect_error', onConnectError);
    socket.on('order:new', onOrderNew);
    socket.on('order:updated', onOrdersChanged);
    socket.on('order:kitchen-updated', onOrdersChanged);
    socket.on('order:paid', onOrdersChanged);

    loadOrders();

    return () => {
      loadGenerationRef.current += 1;
      if (syncDebounceRef.current) {
        clearTimeout(syncDebounceRef.current);
        syncDebounceRef.current = null;
      }
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('reconnect', onReconnect);
      socket.off('connect_error', onConnectError);
      socket.off('order:new', onOrderNew);
      socket.off('order:updated', onOrdersChanged);
      socket.off('order:kitchen-updated', onOrdersChanged);
      socket.off('order:paid', onOrdersChanged);
      socket.disconnect();
      setSocketConnected(false);
    };
  }, [apiBase]);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState !== 'active') {
        return;
      }

      reconnectSocket();
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [reconnectSocket]);

  const visiblePedidos = useMemo(
    () => sortKitchenQueue(pedidos.filter(pedido => pedidoVisibleEnCocina(pedido))),
    [pedidos],
  );

  const counts = useMemo(() => {
    let pendientes = 0;
    let enPreparacion = 0;

    for (const pedido of visiblePedidos) {
      if (pedido.estado === 'pendiente') {
        pendientes += 1;
      } else if (pedido.estado === 'en_preparacion') {
        enPreparacion += 1;
      }
    }

    return {pendientes, enPreparacion, completadosHoy};
  }, [completadosHoy, visiblePedidos]);

  async function persistAndConnect(nextUrl: string) {
    const normalized = nextUrl.trim().replace(/\/$/, '');
    if (!normalized) {
      Alert.alert('Falta la URL', 'Ingresa una URL válida del servidor.');
      return;
    }

    try {
      await AsyncStorage.setItem(STORAGE_API_KEY, normalized);
      setApiBase(normalized);
      setStatus('Conectando con la laptop...');
      setShowConnModal(false);
    } catch (error) {
      Alert.alert('Error', 'No se pudo guardar la configuración.');
    }
  }

  const actualizarPedido = useCallback(async (pedidoId: string, nextEstado: KitchenStatus) => {
    setNowUpdating(pedidoId);
    try {
      const response = await fetch(`${apiBase}/api/orders/${encodeURIComponent(pedidoId)}/kitchen-status`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({kitchenStatus: nextEstado}),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? 'No se pudo actualizar la comanda.');
      }

      const mapped = mapServerOrderToKitchen(payload);
      setPedidos(current => upsertPedidoEnCola(current, mapped));
      return mapped;
    } finally {
      setNowUpdating(null);
    }
  }, [apiBase]);

  const iniciarPreparacion = useCallback(async (pedidoId: string) => {
    try {
      await actualizarPedido(pedidoId, 'en_preparacion');
      setStatus('Pedido enviado a preparación.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo iniciar la preparación.');
    }
  }, [actualizarPedido]);

  const marcarComoCompletado = useCallback(async (pedidoId: string) => {
    try {
      const mapped = await actualizarPedido(pedidoId, 'completado');
      setCompletadosHoy(current => {
        const next = current + 1;
        AsyncStorage.multiSet([
          [STORAGE_COMPLETADOS_KEY, String(next)],
          [STORAGE_COMPLETADOS_DATE_KEY, getTodayKey()],
        ]).catch(() => {});
        return next;
      });

      setPedidoActivo(current => (current?.id === pedidoId ? null : current));
      setStatus(
        mapped && pedidoVisibleEnCocina(mapped)
          ? 'Comanda completada con pendientes. Prepara lo nuevo.'
          : 'Pedido completado. Salió de la cola.',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo completar la comanda.');
    }
  }, [actualizarPedido]);

  const renderOrderCard = useCallback(
    ({item, index}: ListRenderItemInfo<PedidoVista>) => (
      <OrderCard
        item={item}
        queuePosition={index + 1}
        cardWidth={cardWidth}
        nowUpdating={nowUpdating}
        onOpenDetail={() => setPedidoActivo(item)}
        onStart={() => iniciarPreparacion(item.id)}
        onComplete={() => marcarComoCompletado(item.id)}
        isMobile={isMobile}
      />
    ),
    [cardWidth, iniciarPreparacion, isMobile, marcarComoCompletado, nowUpdating],
  );

  const getOrderCardLayout = useCallback(
    (_: ArrayLike<PedidoVista> | null | undefined, index: number) => ({
      length: cardStride,
      offset: cardStride * index,
      index,
    }),
    [cardStride],
  );

  function toggleSound() {
    setSoundOn(current => !current);
  }

  const pedidoModal = pedidoActivo
    ? pedidos.find(pedido => pedido.id === pedidoActivo.id) ?? pedidoActivo
    : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={stylesVars.header} />
      <View style={styles.container}>
        <View style={[styles.header, isMobile && styles.headerMobile]}>
          <View>
            <Text style={[styles.kicker, isMobile && styles.kickerMobile]}>Ahumados Al Barril - Cocina</Text>
            <Text style={[styles.title, isMobile && styles.titleMobile]}>Pantalla de Cocina</Text>
          </View>
          <View style={[styles.headerRight, isMobile && styles.headerRightMobile]}>
            {!isMobile ? <KitchenClock /> : null}
            <Pressable style={[styles.headerButton, isMobile && styles.headerButtonMobile]} onPress={() => setShowConnModal(true)}>
              <Text style={styles.headerButtonText}>Conectar</Text>
            </Pressable>
            {!socketConnected ? (
              <Pressable
                style={[styles.headerButton, styles.headerButtonReconnect, isMobile && styles.headerButtonMobile]}
                onPress={reconnectSocket}
              >
                <Text style={styles.headerButtonText}>Reconectar</Text>
              </Pressable>
            ) : null}
            <Pressable style={[styles.headerButton, isMobile && styles.headerButtonMobile]} onPress={toggleSound}>
              <Text style={styles.headerButtonText}>{soundOn ? '🔔' : '🔕'}</Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.statsRow, isMobile && styles.statsRowMobile]}>
          <StatCard title="Pendientes" value={counts.pendientes} description="Listos para cocina" tone="#fbbf24" isMobile={isMobile} />
          <StatCard title="En Prep." value={counts.enPreparacion} description="En curso" tone="#7dd3fc" isMobile={isMobile} />
          <StatCard
            title="Completados hoy"
            value={counts.completadosHoy}
            description="Ya salieron de la cola"
            tone="#86efac"
            isMobile={isMobile}
          />
        </View>

        <View style={[styles.content, isMobile && styles.contentMobile]}>
          <View style={[styles.contentHeader, isMobile && styles.contentHeaderMobile]}>
            <View>
              <Text style={[styles.sectionKicker, isMobile && styles.sectionKickerMobile]}>Pedidos activos</Text>
              <Text style={[styles.sectionTitle, isMobile && styles.sectionTitleMobile]}>
                Solo comandas activas (pendiente o en preparación). Al marcar completado salen de la cola; vuelven si el mesero agrega platos
              </Text>
            </View>
            <View style={[styles.statusPill, !socketConnected && styles.statusPillOffline]}>
              {loading ? (
                <ActivityIndicator size="small" color="#7c2d12" />
              ) : (
                <Text style={[styles.statusText, !socketConnected && styles.statusTextOffline]}>
                  {!socketConnected ? '● Desconectado · ' : '● En línea · '}
                  {status}
                </Text>
              )}
            </View>
          </View>

          <FlatList
            data={visiblePedidos}
            keyExtractor={item => String(item.id)}
            horizontal
            scrollEnabled
            showsHorizontalScrollIndicator
            showsVerticalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={cardStride}
            snapToAlignment="start"
            disableIntervalMomentum
            initialNumToRender={3}
            maxToRenderPerBatch={4}
            windowSize={5}
            removeClippedSubviews={Platform.OS === 'android'}
            getItemLayout={getOrderCardLayout}
            extraData={nowUpdating}
            style={styles.ordersList}
            contentContainerStyle={[styles.cardsContent, isMobile && styles.cardsContentMobile]}
            renderItem={renderOrderCard}
            ListEmptyComponent={
              <View style={[styles.emptyState, {width: Math.max(cardWidth, windowWidth - 48)}]}>
                <Text style={styles.emptyTitle}>Sin comandas activas</Text>
                <Text style={styles.emptyText}>{status}</Text>
              </View>
            }
          />
        </View>
      </View>

      <Modal visible={showConnModal} transparent animationType="fade" onRequestClose={() => setShowConnModal(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Conectar a la laptop</Text>
            <Text style={styles.modalDescription}>
              Ingresa la URL del servidor de la laptop, por ejemplo http://192.168.1.42:4000
            </Text>

            <TextInput
              value={connDraft}
              onChangeText={setConnDraft}
              placeholder="http://192.168.1.42:4000"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
            />

            <View style={styles.modalActions}>
              <Pressable style={styles.modalSecondaryButton} onPress={() => setShowConnModal(false)}>
                <Text style={styles.modalSecondaryButtonText}>Cerrar</Text>
              </Pressable>
              <Pressable
                style={styles.modalPrimaryButton}
                onPress={() => {
                  persistAndConnect(connDraft).catch(() => {});
                }}
              >
                <Text style={styles.modalPrimaryButtonText}>Guardar y conectar</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={Boolean(pedidoModal)} transparent animationType="slide" onRequestClose={() => setPedidoActivo(null)}>
        <View style={styles.detailOverlay}>
          <View style={styles.detailCard}>
            <View style={styles.detailHeader}>
              <View style={{flex: 1}}>
                <Text style={styles.modalTitle}>Detalle completo del pedido</Text>
                <Text style={styles.detailSubtitle}>Pedido #{pedidoModal?.id} • {pedidoModal?.nombreCliente} • Mesa {pedidoModal?.numeroMesa}</Text>
              </View>
              <Pressable style={styles.closeButton} onPress={() => setPedidoActivo(null)}>
                <Text style={styles.closeButtonText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={{maxHeight: 360}} contentContainerStyle={{gap: 12}}>
              {pedidoModal && pedidoTieneHistorialPreparado(pedidoModal) ? <PreparedReopenBanner /> : null}
              {pedidoModal && pedidoFueModificado(pedidoModal) ? (
                <EditChangesPanel editSummary={pedidoModal.editSummary} />
              ) : null}

              {pedidoModal?.items.map((item, index) => (
                <View key={`${pedidoModal.id}-detail-${index}`} style={styles.detailItemWrap}>
                  <KitchenItemRows item={item} />
                </View>
              ))}

              <View style={styles.commentsSection}>
                <Text style={styles.commentsTitle}>Comentarios</Text>
                {pedidoModal?.comments.length ? (
                  <View style={styles.commentHistory}>
                    {pedidoModal.comments.map((comment, index) => (
                      <View key={`${pedidoModal.id}-comment-${index}`} style={styles.commentHistoryItem}>
                        <Text style={styles.commentHistoryText}>{comment.text}</Text>
                        <Text style={styles.commentHistoryMeta}>
                          {comment.author || 'Mesero'}
                          {formatCommentDate(comment.createdAt) ? ` · ${formatCommentDate(comment.createdAt)}` : ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.commentsEmpty}>No hay comentarios registrados para esta comanda.</Text>
                )}
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable style={styles.modalSecondaryButton} onPress={() => setPedidoActivo(null)}>
                <Text style={styles.modalSecondaryButtonText}>Cerrar</Text>
              </Pressable>
              {pedidoModal?.estado === 'pendiente' ? (
                <Pressable
                  style={styles.modalPrimaryButton}
                  onPress={() => {
                    if (pedidoModal) {
                      iniciarPreparacion(pedidoModal.id).catch(() => {});
                      setPedidoActivo(null);
                    }
                  }}
                >
                  <Text style={styles.modalPrimaryButtonText}>Iniciar Preparación</Text>
                </Pressable>
              ) : pedidoModal?.estado === 'en_preparacion' ? (
                <Pressable
                  style={styles.modalPrimaryButton}
                  onPress={() => {
                    if (pedidoModal) {
                      marcarComoCompletado(pedidoModal.id).catch(() => {});
                      setPedidoActivo(null);
                    }
                  }}
                >
                  <Text style={styles.modalPrimaryButtonText}>Marcar Completado</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

type OrderCardProps = {
  item: PedidoVista;
  queuePosition: number;
  cardWidth: number;
  nowUpdating: string | null;
  onOpenDetail: () => void;
  onStart: () => void;
  onComplete: () => void;
  isMobile?: boolean;
};

const KitchenClock = memo(function KitchenClock() {
  const [ahora, setAhora] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.clockBox}>
      <Text style={styles.clock}>{formatTimeNow(ahora)}</Text>
      <Text style={styles.date}>{formatDateNow(ahora)}</Text>
    </View>
  );
});

function PlateNote({notas, muted}: {notas?: string; muted?: boolean}) {
  const text = String(notas ?? '').trim();
  if (!text) {
    return null;
  }

  return (
    <View style={[styles.plateNoteCard, muted && styles.plateNoteCardMuted]}>
      <Text style={[styles.plateNoteLabel, muted && styles.plateNoteLabelMuted]}>Nota del plato</Text>
      <Text style={[styles.plateNoteText, muted && styles.plateNoteTextMuted]}>{text}</Text>
    </View>
  );
}

function PreparedReopenBanner() {
  return (
    <View style={styles.reopenBanner}>
      <Text style={styles.reopenBannerTitle}>Comanda ampliada</Text>
      <Text style={styles.reopenBannerHint}>Gris = ya preparado · Resaltado = preparar ahora</Text>
    </View>
  );
}

function KitchenItemRows({item}: {item: PedidoItem}) {
  const preparada = item.cantidadPreparada ?? 0;
  const pendiente = item.cantidadPendiente ?? item.cantidad;
  const todoPreparado = Boolean(item.preparado) || pendiente <= 0;

  if (todoPreparado && preparada > 0) {
    return (
      <View style={[styles.itemRow, styles.itemRowPrepared]}>
        <View style={[styles.quantityBubble, styles.quantityBubblePrepared]}>
          <Text style={styles.quantityTextPrepared}>{preparada}</Text>
        </View>
        <View style={{flex: 1}}>
          <Text style={styles.itemLabelPrepared}>Ya preparado</Text>
          <Text style={styles.itemNamePrepared}>{item.nombre}</Text>
          <PlateNote notas={item.notas} muted />
        </View>
      </View>
    );
  }

  return (
    <>
      {preparada > 0 ? (
        <View style={[styles.itemRow, styles.itemRowPrepared]}>
          <View style={[styles.quantityBubble, styles.quantityBubblePrepared]}>
            <Text style={styles.quantityTextPrepared}>{preparada}</Text>
          </View>
          <View style={{flex: 1}}>
            <Text style={styles.itemLabelPrepared}>Ya preparado</Text>
            <Text style={styles.itemNamePrepared}>{item.nombre}</Text>
            <PlateNote notas={item.notas} muted />
          </View>
        </View>
      ) : null}
      {pendiente > 0 ? (
        <View style={[styles.itemRow, item.editado && styles.itemRowEdited]}>
          <View style={[styles.quantityBubble, item.editado && styles.quantityBubbleEdited]}>
            <Text style={styles.quantityText}>{pendiente}</Text>
          </View>
          <View style={{flex: 1}}>
            <Text style={styles.itemLabel}>{item.editado ? 'Por preparar' : 'Item'}</Text>
            <Text style={styles.itemName}>{item.nombre}</Text>
            <PlateNote notas={item.notas} />
          </View>
        </View>
      ) : null}
    </>
  );
}

function EditChangesPanel({editSummary}: {editSummary: EditChange[]}) {
  if (!editSummary.length) {
    return null;
  }

  return (
    <View style={styles.editAlertBanner}>
      <Text style={styles.editAlertIcon}>⚠️</Text>
      <View style={styles.editAlertBody}>
        <Text style={styles.editAlertTitle}>Comanda modificada</Text>
        <Text style={styles.editAlertHint}>Revisa los cambios antes de preparar</Text>
        {editSummary.map((change, index) => (
          <View key={`${change.menuItemId}-${change.type}-${index}`} style={styles.editAlertItem}>
            <Text style={styles.editAlertItemName}>{change.nombre}</Text>
            <Text style={styles.editAlertItemChange}>{getEditChangeLabel(change)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const OrderCard = memo(function OrderCard({
  item,
  queuePosition,
  cardWidth,
  nowUpdating,
  onOpenDetail,
  onStart,
  onComplete,
  isMobile,
}: OrderCardProps) {
  const style = statusMeta[item.estado];
  const latestComment = item.comments[item.comments.length - 1];
  const latestCommentDate = latestComment ? formatCommentDate(latestComment.createdAt) : '';
  const showDetailLink = item.items.length > 4 || item.comments.length > 1;
  const fueModificado = pedidoFueModificado(item);
  const esReapertura = pedidoEsReapertura(item);
  const tieneHistorialPreparado = pedidoTieneHistorialPreparado(item);

  return (
    <View
      style={[
        styles.card,
        isMobile && styles.cardMobile,
        (fueModificado || tieneHistorialPreparado) && styles.cardModified,
        tieneHistorialPreparado && styles.cardReopened,
        {width: cardWidth},
      ]}
    >
      <View style={[styles.cardTop, {backgroundColor: style.accent, borderColor: style.color}]}>
        <View style={{flex: 1}}>
          <Text style={styles.customer} numberOfLines={1}>
            {item.nombreCliente}
          </Text>
          <Text style={styles.cardMeta} numberOfLines={2}>
            Cola #{queuePosition} • Mesa {item.numeroMesa} • {style.label} • {item.horaRecibido}
          </Text>
        </View>
        <View style={styles.cardTopBadges}>
          {fueModificado ? (
            <View style={styles.editBadge} accessibilityLabel="Comanda modificada">
              <Text style={styles.editBadgeIcon}>⚠️</Text>
            </View>
          ) : null}
          <View style={[styles.badge, {backgroundColor: style.color}]}>
            <Text style={styles.badgeText}>#{item.id}</Text>
          </View>
        </View>
      </View>

      {tieneHistorialPreparado ? <PreparedReopenBanner /> : null}
      {fueModificado ? <EditChangesPanel editSummary={item.editSummary} /> : null}

      <ScrollView
        style={styles.cardScroll}
        contentContainerStyle={styles.cardScrollContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        {item.items.map((orderItem, index) => (
          <KitchenItemRows key={`${item.id}-item-${index}`} item={orderItem} />
        ))}

        {latestComment ? (
          <View style={styles.commentPreviewCard}>
            <Text style={styles.commentPreviewLabel}>Comentario reciente</Text>
            <Text style={styles.commentPreviewText}>{latestComment.text}</Text>
            <Text style={styles.commentPreviewMeta}>
              {latestComment.author || 'Mesero'}
              {latestCommentDate ? ` · ${latestCommentDate}` : ''}
            </Text>
          </View>
        ) : null}

        {showDetailLink ? (
          <Pressable style={styles.secondaryButton} onPress={onOpenDetail}>
            <Text style={styles.secondaryButtonText}>Ver detalle completo</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={styles.cardFooter}>
        {item.estado === 'pendiente' ? (
          <Pressable
            style={({pressed}) => [styles.primaryButton, pressed && styles.buttonPressed]}
            onPress={onStart}
            disabled={nowUpdating === item.id}
          >
            <Text style={styles.primaryButtonText}>Iniciar Preparación</Text>
          </Pressable>
        ) : item.estado === 'en_preparacion' ? (
          <Pressable
            style={({pressed}) => [styles.successButton, pressed && styles.buttonPressed]}
            onPress={onComplete}
            disabled={nowUpdating === item.id}
          >
            <Text style={styles.primaryButtonText}>Marcar Completado</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

const StatCard = memo(function StatCard({
  title,
  value,
  description,
  tone,
  isMobile,
}: {
  title: string;
  value: number;
  description: string;
  tone: string;
  isMobile?: boolean;
}) {
  if (isMobile) {
    return (
      <View style={[styles.statCard, styles.statCardMobile]}>
        <View style={[styles.statTopMobile, {backgroundColor: tone}]}>
          <Text style={styles.statTitleMobile} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.statValueMobile}>{value}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.statCard}>
      <View style={[styles.statTop, {backgroundColor: tone}]}>
        <View style={{flex: 1}}>
          <Text style={styles.statTitle}>{title}</Text>
          <Text style={styles.statValue}>{value}</Text>
        </View>
      </View>
      <Text style={styles.statDescription}>{description}</Text>
    </View>
  );
});

const stylesVars = {
  header: '#8b421d',
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f7efe6',
  },
  container: {
    flex: 1,
    backgroundColor: '#f7efe6',
  },
  header: {
    backgroundColor: '#8b421d',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  kicker: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
    marginTop: 4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  clockBox: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 120,
  },
  clock: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'right',
  },
  date: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
    marginTop: 4,
    textTransform: 'uppercase',
  },
  headerButton: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerButtonText: {
    color: '#2f2016',
    fontWeight: '900',
  },
  headerButtonReconnect: {
    backgroundColor: '#fde68a',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 24,
    overflow: 'hidden',
  },
  statTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statTitle: {
    color: 'rgba(47,32,22,0.65)',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  statValue: {
    color: '#2f2016',
    fontSize: 24,
    fontWeight: '900',
    marginTop: 6,
  },
  statDescription: {
    color: '#5b4635',
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  content: {
    flex: 1,
    marginTop: 12,
    marginHorizontal: 12,
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.46)',
    borderRadius: 32,
    padding: 14,
  },
  contentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
    flexShrink: 0,
  },
  sectionKicker: {
    color: '#9a571f',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  sectionTitle: {
    color: '#2f2016',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 4,
    flexShrink: 1,
  },
  statusPill: {
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxWidth: 280,
  },
  statusPillOffline: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
  },
  statusText: {
    color: '#4b341f',
    fontWeight: '700',
    fontSize: 12,
  },
  statusTextOffline: {
    color: '#991b1b',
  },
  ordersList: {
    flex: 1,
    minHeight: 0,
  },
  cardsContent: {
    gap: 12,
    paddingRight: 12,
    alignItems: 'stretch',
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 28,
    overflow: 'hidden',
    flexDirection: 'column',
    minHeight: 0,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardModified: {
    borderColor: '#f59e0b',
    borderWidth: 2,
  },
  cardReopened: {
    borderColor: '#6366f1',
  },
  reopenBanner: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#eef2ff',
    borderBottomWidth: 1,
    borderBottomColor: '#c7d2fe',
    gap: 2,
  },
  reopenBannerTitle: {
    color: '#3730a3',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  reopenBannerHint: {
    color: '#4f46e5',
    fontSize: 11,
    fontWeight: '600',
  },
  cardTopBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  editBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fef3c7',
    borderWidth: 2,
    borderColor: '#f59e0b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBadgeIcon: {
    fontSize: 18,
  },
  editAlertBanner: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff7ed',
    borderBottomWidth: 1,
    borderBottomColor: '#fdba74',
  },
  editAlertIcon: {
    fontSize: 22,
    marginTop: 2,
  },
  editAlertBody: {
    flex: 1,
    gap: 4,
  },
  editAlertTitle: {
    color: '#9a3412',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  editAlertHint: {
    color: '#c2410c',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  editAlertItem: {
    marginTop: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(251, 146, 60, 0.35)',
  },
  editAlertItemName: {
    color: '#7c2d12',
    fontSize: 14,
    fontWeight: '900',
  },
  editAlertItemChange: {
    color: '#b45309',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  cardScroll: {
    flex: 1,
    minHeight: 0,
  },
  cardScrollContent: {
    padding: 16,
    gap: 10,
    paddingBottom: 12,
  },
  cardFooter: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: '#eadccf',
    backgroundColor: 'rgba(255,255,255,0.98)',
  },
  cardTop: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  customer: {
    color: '#2f2016',
    fontSize: 18,
    fontWeight: '900',
  },
  cardMeta: {
    color: 'rgba(47,32,22,0.75)',
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  badgeText: {
    color: '#fff',
    fontWeight: '900',
  },
  itemRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: '#fff8ef',
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: '#eadccf',
  },
  itemRowEdited: {
    backgroundColor: '#fffbeb',
    borderColor: '#f59e0b',
    borderWidth: 2,
  },
  itemRowPrepared: {
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
    opacity: 0.95,
  },
  itemLabelPrepared: {
    fontSize: 11,
    fontWeight: '900',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  itemNamePrepared: {
    color: '#6b7280',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
    textDecorationLine: 'line-through',
  },
  itemNotesPrepared: {
    marginTop: 6,
    color: '#9ca3af',
    fontWeight: '600',
    fontSize: 12,
  },
  quantityBubblePrepared: {
    backgroundColor: '#9ca3af',
  },
  quantityTextPrepared: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 16,
  },
  detailItemWrap: {
    gap: 8,
  },
  quantityBubble: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: '#c96c2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityBubbleEdited: {
    backgroundColor: '#ea580c',
  },
  quantityText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 16,
  },
  itemLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#a65a20',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  itemName: {
    color: '#2f2016',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },
  plateNoteCard: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#f4c38d',
    gap: 2,
  },
  plateNoteCardMuted: {
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
  },
  plateNoteLabel: {
    color: '#9a3412',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  plateNoteLabelMuted: {
    color: '#6b7280',
  },
  plateNoteText: {
    color: '#7c2d12',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  plateNoteTextMuted: {
    color: '#6b7280',
  },
  secondaryButton: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#d8b98d',
    backgroundColor: '#fff3e0',
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#8e531f',
    fontWeight: '900',
  },
  commentPreviewCard: {
    backgroundColor: '#fff7ed',
    borderColor: '#f4c38d',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  commentPreviewLabel: {
    color: '#9a3412',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  commentPreviewText: {
    color: '#3b2a1a',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  commentPreviewMeta: {
    color: '#8b5e3c',
    fontSize: 11,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: '#56718a',
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  successButton: {
    backgroundColor: '#4f7d4d',
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 16,
  },
  disabledButton: {
    backgroundColor: '#ddd6d0',
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  disabledButtonText: {
    color: '#7c736b',
    fontWeight: '900',
    fontSize: 16,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  emptyState: {
    width: '100%',
    minHeight: 300,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: {
    color: '#2f2016',
    fontSize: 22,
    fontWeight: '900',
  },
  emptyText: {
    color: '#6d584b',
    marginTop: 10,
    textAlign: 'center',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 20,
    gap: 10,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#2f2016',
  },
  modalDescription: {
    color: '#5f5146',
    fontWeight: '600',
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d9c9b6',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#2f2016',
    backgroundColor: '#fffaf4',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 6,
    flexWrap: 'wrap',
  },
  modalSecondaryButton: {
    backgroundColor: '#e7e1da',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  modalSecondaryButtonText: {
    color: '#473a31',
    fontWeight: '900',
  },
  modalPrimaryButton: {
    backgroundColor: '#4f7d4d',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  modalPrimaryButtonText: {
    color: '#fff',
    fontWeight: '900',
  },
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(35,22,16,0.72)',
    justifyContent: 'center',
    padding: 18,
  },
  detailCard: {
    backgroundColor: '#fff',
    borderRadius: 28,
    padding: 18,
    gap: 14,
    maxHeight: '86%',
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  detailSubtitle: {
    color: '#6d584b',
    marginTop: 8,
    fontWeight: '700',
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f1ebe4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#46362d',
    fontSize: 18,
    fontWeight: '900',
  },
  detailItem: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ebdfd1',
    backgroundColor: '#fffaf4',
  },
  detailQty: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#c96c2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailQtyText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 18,
  },
  detailNotes: {
    marginTop: 6,
    color: '#6d584b',
    fontWeight: '600',
  },
  commentsSection: {
    gap: 10,
  },
  commentsTitle: {
    color: '#8b421d',
    fontSize: 16,
    fontWeight: '900',
  },
  commentsEmpty: {
    color: '#7c5e44',
    fontSize: 13,
    fontWeight: '600',
  },
  commentHistory: {
    gap: 10,
  },
  commentHistoryItem: {
    backgroundColor: '#fff7ed',
    borderColor: '#f4c38d',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  commentHistoryText: {
    color: '#3b2a1a',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  commentHistoryMeta: {
    color: '#8b5e3c',
    fontSize: 11,
    fontWeight: '600',
  },
  // ========== RESPONSIVE MOBILE STYLES ==========
  headerMobile: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  kickerMobile: {
    fontSize: 10,
  },
  titleMobile: {
    fontSize: 20,
  },
  headerRightMobile: {
    gap: 6,
  },
  headerButtonMobile: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  statsRowMobile: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 2,
  },
  statCardMobile: {
    flex: 1,
    borderRadius: 14,
  },
  statTopMobile: {
    borderRadius: 14,
    paddingHorizontal: 6,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 56,
  },
  statTitleMobile: {
    color: 'rgba(47,32,22,0.7)',
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  statValueMobile: {
    color: '#2f2016',
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
  },
  contentMobile: {
    marginTop: 6,
    marginHorizontal: 10,
    marginBottom: 8,
    padding: 10,
    borderRadius: 22,
  },
  contentHeaderMobile: {
    marginBottom: 6,
  },
  sectionKickerMobile: {
    fontSize: 10,
  },
  sectionTitleMobile: {
    fontSize: 13,
    marginTop: 3,
  },
  cardsContentMobile: {
    paddingLeft: 4,
    paddingRight: 16,
    alignItems: 'stretch',
  },
  cardMobile: {
    flex: 1,
  },
});
